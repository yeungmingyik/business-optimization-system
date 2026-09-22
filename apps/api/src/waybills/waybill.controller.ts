import {
  Controller,
  Body,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { AuthRequest } from '../auth.service';
import { storagePath, uploadStorage } from '../transfer/storage';
import { WaybillService } from './waybill.service';
import { WaybillRecognitionService } from './waybill-recognition.service';
import { parse } from '../validation';
import { z } from 'zod';

@Controller('waybills')
export class WaybillController {
  constructor(
    @Inject(WaybillService) private readonly waybills: WaybillService,
    @Inject(WaybillRecognitionService) private readonly recognition: WaybillRecognitionService,
  ) {}

  @Post(':id/recognize')
  @HttpCode(200)
  async recognize(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(z.object({}).strict(), body ?? {});
    const controller = new AbortController();
    const abort = () => controller.abort();
    const close = () => {
      if (!response.writableEnded) abort();
    };
    request.once('aborted', abort);
    response.once('close', close);
    if (request.aborted || response.destroyed) abort();
    try {
      return await this.recognition.recognize(request, id, controller.signal);
    } finally {
      request.off('aborted', abort);
      response.off('close', close);
    }
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(@Req() request: AuthRequest, @UploadedFile() file?: Express.Multer.File) {
    return this.waybills.upload(request.user, file);
  }

  @Get(':id')
  get(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.waybills.get(request.user, id);
  }

  @Delete(':id')
  remove(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.waybills.remove(request.user, id);
  }

  @Get(':id/content')
  async content(@Req() request: AuthRequest, @Param('id') id: string, @Res() response: Response) {
    const file = await this.waybills.accessible(request.user, id);
    response.setHeader('Content-Type', file.media_type);
    response.setHeader('Content-Length', file.bytes);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    response.setHeader('Content-Disposition', 'inline');
    await pipeline(createReadStream(storagePath(file.storage_key)), response);
  }
}
