import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';
import type { AuthRequest } from '../auth.service';
import { fail } from '../validation';
import { uploadStorage } from './storage';
import { TransferService } from './transfer.service';

type Download = {
  path: string;
  name: string;
  mediaType: string;
  bytes?: number;
  disposable?: boolean;
};

async function sendFile(request: AuthRequest, response: Response, file: Download, inline = false) {
  const size = file.bytes ?? (await stat(file.path)).size;
  response.setHeader('Content-Type', file.mediaType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
  );
  if (inline) response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  response.setHeader('Accept-Ranges', 'bytes');
  let start = 0;
  let end = size - 1;
  if (request.headers.range) {
    const matched = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!matched || (!matched[1] && !matched[2])) {
      response.status(416).setHeader('Content-Range', `bytes */${size}`);
      response.end();
      if (file.disposable) await unlink(file.path).catch(() => undefined);
      return;
    }
    if (!matched[1]) start = Math.max(0, size - Number(matched[2]));
    else {
      start = Number(matched[1]);
      if (matched[2]) end = Math.min(Number(matched[2]), size - 1);
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    ) {
      response.status(416).setHeader('Content-Range', `bytes */${size}`);
      response.end();
      if (file.disposable) await unlink(file.path).catch(() => undefined);
      return;
    }
    response.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  response.setHeader('Content-Length', end - start + 1);
  try {
    await pipeline(createReadStream(file.path, { start, end }), response);
  } finally {
    if (file.disposable) await unlink(file.path).catch(() => undefined);
  }
}

const assetsInterceptor = FileInterceptor('file', {
  storage: uploadStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 3, fieldSize: 65536, parts: 5 },
});
const importInterceptor = FileInterceptor('file', {
  storage: uploadStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2, fieldSize: 1024, parts: 4 },
});

@Controller()
export class TransferController {
  constructor(@Inject(TransferService) private readonly transfer: TransferService) {}

  @Get('assets')
  listAssets(@Req() request: AuthRequest, @Query() query: Record<string, string>) {
    return this.transfer.listAssets(request.user, query);
  }

  @Get('assets/:id')
  getAsset(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.transfer.getAsset(request.user, id);
  }

  @Post('assets')
  @UseInterceptors(assetsInterceptor)
  async createAsset(
    @Req() request: AuthRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(body.metadata);
    } catch {
      if (file) await unlink(file.path).catch(() => undefined);
      fail('资料信息格式错误');
    }
    return this.transfer.createAsset(request.user, file, metadata);
  }

  @Patch('assets/:id')
  updateAsset(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transfer.updateAsset(request.user, id, body);
  }

  @Post('assets/:id/versions')
  @UseInterceptors(assetsInterceptor)
  replaceAsset(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    return this.transfer.replaceAsset(request.user, id, file, Number(body.version));
  }

  @Post('assets/:id/archive')
  archiveAsset(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transfer.archiveAsset(request.user, id, body, true);
  }

  @Post('assets/:id/restore')
  restoreAsset(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transfer.archiveAsset(request.user, id, body, false);
  }

  @Get('assets/:id/download')
  async downloadAsset(
    @Req() request: AuthRequest,
    @Res() response: Response,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
  ) {
    await sendFile(
      request,
      response,
      await this.transfer.assetDownload(request.user, id, versionId),
    );
  }

  @Get('assets/:id/preview')
  async previewAsset(
    @Req() request: AuthRequest,
    @Res() response: Response,
    @Param('id') id: string,
    @Query('versionId') versionId?: string,
  ) {
    await sendFile(
      request,
      response,
      await this.transfer.assetDownload(request.user, id, versionId, true),
      true,
    );
  }

  @Get('import-templates/:kind')
  async template(
    @Req() request: AuthRequest,
    @Res() response: Response,
    @Param('kind') kind: string,
  ) {
    await sendFile(request, response, await this.transfer.template(kind));
  }

  @Post('imports/preview')
  @UseInterceptors(importInterceptor)
  previewImport(
    @Req() request: AuthRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    return this.transfer.previewImport(request.user, body.kind, file);
  }

  @Get('imports/:id')
  importJob(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.transfer.getJob(request.user, id, 'IMPORT');
  }

  @Get('imports')
  importJobs(@Req() request: AuthRequest, @Query() query: Record<string, string>) {
    return this.transfer.listJobs(request.user, 'IMPORT', query);
  }

  @Post('imports/:id/commit')
  commitImport(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.transfer.commitImport(request.user, id, body);
  }

  @Get('imports/:id/errors')
  async importErrors(
    @Req() request: AuthRequest,
    @Res() response: Response,
    @Param('id') id: string,
  ) {
    await sendFile(request, response, await this.transfer.importErrors(request.user, id));
  }

  @Post('exports')
  createExport(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.transfer.createExport(request.user, body);
  }

  @Get('exports/:id')
  exportJob(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.transfer.getJob(request.user, id, 'EXPORT');
  }

  @Get('exports')
  exportJobs(@Req() request: AuthRequest, @Query() query: Record<string, string>) {
    return this.transfer.listJobs(request.user, 'EXPORT', query);
  }

  @Get('exports/:id/download')
  async downloadExport(
    @Req() request: AuthRequest,
    @Res() response: Response,
    @Param('id') id: string,
  ) {
    await sendFile(request, response, await this.transfer.exportDownload(request.user, id));
  }
}
