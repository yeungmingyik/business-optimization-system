import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let status = error instanceof HttpException ? error.getStatus() : 500;
    let value: any = error instanceof HttpException ? error.getResponse() : null;
    if (error?.type === 'entity.too.large') {
      status = 413;
      value = { code: 'PAYLOAD_TOO_LARGE', message: '提交内容过大' };
    }
    if (error?.type === 'entity.parse.failed') {
      status = 400;
      value = { code: 'INVALID_JSON', message: '请求内容无效' };
    }
    if (
      ['57P01', '57P02', '57P03', '08006', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(
        error?.code,
      ) ||
      error?.message === 'Connection terminated unexpectedly'
    ) {
      status = 503;
      value = { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试' };
    }
    if (error?.code === '23505') {
      status = 409;
      value = { code: 'DUPLICATE', message: '记录已存在或无法保存' };
    }
    if (['23503', '22P02', '22007', '22008', '23514', '22003'].includes(error?.code)) {
      status = 422;
      value = { code: 'VALIDATION', message: '字段或关联数据无效' };
    }
    if (error?.code === '40P01' || error?.code === '40001') {
      status = 409;
      value = { code: 'CONCURRENT_CHANGE', message: '数据正在更新，请重试' };
    }
    if (status === 500)
      process.stderr.write(
        `${JSON.stringify({ event: 'request_error', code: error?.code ?? 'INTERNAL_ERROR', name: error?.name ?? 'Error', message: error?.message ?? '' })}\n`,
      );
    response.status(status).json({
      code: value?.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message: typeof value === 'string' ? value : (value?.message ?? '请求失败，请重试'),
      fieldErrors: value?.fieldErrors ?? {},
      requestId: randomUUID(),
    });
  }
}
