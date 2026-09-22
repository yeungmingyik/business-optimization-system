import { HttpException, Inject, Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AuthService, type AuthRequest } from '../auth.service';
import { storagePath } from '../transfer/storage';
import { fail } from '../validation';
import { WaybillService } from './waybill.service';
import { parseWaybillText } from './waybill-text';

const recognitionResponse = z.object({
  lines: z
    .array(
      z.object({
        text: z.string().max(5000),
        score: z.number().finite().min(0).max(1),
        box: z.array(z.array(z.number().finite()).length(2)).min(4).max(16),
      }),
    )
    .max(5000),
  durationMs: z.number().finite().nonnegative(),
  engine: z.string().min(1).max(200),
});

@Injectable()
export class WaybillRecognitionService {
  private active = 0;
  private readonly activeUsers = new Set<string>();

  constructor(
    @Inject(WaybillService) private readonly waybills: WaybillService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async recognize(request: AuthRequest, id: string, signal: AbortSignal) {
    const user = request.user;
    const file = await this.waybills.accessible(user, id);
    if (signal.aborted) fail('识别已取消', 499, 'REQUEST_CANCELLED');
    if (this.active >= 2 || this.activeUsers.has(user.id))
      fail('识别繁忙，请稍后重试', 429, 'OCR_BUSY');
    let endpoint: URL;
    try {
      endpoint = new URL(`${(process.env.BOS_OCR_URL ?? '').replace(/\/+$/, '')}/recognize`);
      if (
        !['http:', 'https:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error('INVALID_OCR_URL');
      if (!process.env.BOS_OCR_TOKEN) throw new Error('MISSING_OCR_TOKEN');
    } catch {
      fail('识别服务暂不可用，请稍后重试', 503, 'OCR_UNAVAILABLE');
    }
    this.active += 1;
    this.activeUsers.add(user.id);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90000);
    timer.unref();
    try {
      const bytes = await readFile(storagePath(file.storage_key), { signal: controller.signal });
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': file.media_type,
          Authorization: `Bearer ${process.env.BOS_OCR_TOKEN}`,
        },
        body: new Uint8Array(bytes),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 429) fail('识别繁忙，请稍后重试', 429, 'OCR_BUSY');
      if (response.status === 504) fail('识别超时，请重试或手动填写', 504, 'OCR_TIMEOUT');
      if (!response.ok) fail('识别服务暂不可用，请稍后重试', 503, 'OCR_UNAVAILABLE');
      const parsed = recognitionResponse.safeParse(await response.json());
      if (!parsed.success) fail('识别服务暂不可用，请稍后重试', 503, 'OCR_UNAVAILABLE');
      const current = await this.auth.authenticate(request);
      if (current.mustChangePassword || current.role !== user.role)
        fail('登录已失效，请重新登录', 401, 'UNAUTHORIZED');
      await this.waybills.accessible(current, id);
      controller.signal.throwIfAborted();
      return parseWaybillText(
        parsed.data.lines
          .filter((line) => line.score >= 0.5)
          .map((line) => line.text)
          .join('\n'),
      );
    } catch (error) {
      if (signal.aborted) fail('识别已取消', 499, 'REQUEST_CANCELLED');
      if (timedOut) fail('识别超时，请重试或手动填写', 504, 'OCR_TIMEOUT');
      if (error instanceof HttpException) throw error;
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        fail('运单附件不可用', 404, 'NOT_FOUND');
      fail('识别服务暂不可用，请稍后重试', 503, 'OCR_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      this.active -= 1;
      this.activeUsers.delete(user.id);
    }
  }
}
