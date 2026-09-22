import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WaybillRecognitionService } from '../apps/api/src/waybills/waybill-recognition.service';
import { WaybillController } from '../apps/api/src/waybills/waybill.controller';
import { fail } from '../apps/api/src/validation';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), unlink: vi.fn() }));

const attachmentId = randomUUID();
const image = Buffer.from('synthetic-image-bytes');
const user = { id: randomUUID(), role: 'OPERATOR', mustChangePassword: false };
const file = { storage_key: `${randomUUID()}.upload`, media_type: 'image/png' };
const box = [
  [0, 0],
  [100, 0],
  [100, 20],
  [0, 20],
];
const result = {
  engine: 'PaddleOCR-test',
  durationMs: 10,
  lines: [{ text: 'DPK8765432109876', score: 0.99, box }],
};

function requestFor(id = user.id) {
  return { user: { ...user, id }, cookies: { bos_session: 'synthetic-session' } } as never;
}

function fixture() {
  const waybills = { accessible: vi.fn().mockResolvedValue(file) };
  const auth = { authenticate: vi.fn().mockImplementation(async (request) => request.user) };
  const service = new WaybillRecognitionService(waybills as never, auth as never);
  return { service, waybills, auth };
}

function status(status: number, code: string) {
  return { status, response: expect.objectContaining({ code }) };
}

beforeEach(() => {
  vi.stubEnv('BOS_OCR_URL', 'http://127.0.0.1:8000/');
  vi.stubEnv('BOS_OCR_TOKEN', 'synthetic-ocr-service-token');
  vi.stubEnv('BOS_UPLOAD_ROOT', 'D:\\business-optimization-system\\.data\\uploads-test');
  vi.mocked(readFile).mockResolvedValue(image);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('运单识别服务边界', () => {
  test('先授权再读取附件，二进制仅发送配置服务并再次复核当前访问权', async () => {
    const { service, waybills, auth } = fixture();
    const request = requestFor();
    expect(await service.recognize(request, attachmentId, new AbortController().signal)).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK8765432109876',
    });
    expect(waybills.accessible).toHaveBeenCalledTimes(2);
    expect(auth.authenticate).toHaveBeenCalledWith(request);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8000/recognize');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'image/png', Authorization: 'Bearer synthetic-ocr-service-token' },
      body: new Uint8Array(image),
    });
    expect(waybills.accessible.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(readFile).mock.invocationCallOrder[0],
    );
  });

  test('无权限附件不读取文件也不调用识别服务', async () => {
    const { service, waybills } = fixture();
    waybills.accessible.mockImplementation(async () => fail('运单附件不可用', 404, 'NOT_FOUND'));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(404, 'NOT_FOUND'));
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('配置缺失不向任意地址发送图片', async () => {
    const { service } = fixture();
    vi.stubEnv('BOS_OCR_TOKEN', '');
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(503, 'OCR_UNAVAILABLE'));
    expect(fetch).not.toHaveBeenCalled();
  });

  test('请求取消终止内部识别且释放忙碌状态', async () => {
    const { service } = fixture();
    let upstreamSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          upstreamSignal = options?.signal as AbortSignal;
          upstreamSignal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = service.recognize(requestFor(), attachmentId, controller.signal);
    const rejection = expect(pending).rejects.toMatchObject(status(499, 'REQUEST_CANCELLED'));
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    controller.abort();
    await rejection;
    expect(upstreamSignal!.aborted).toBe(true);
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).resolves.toMatchObject({ trackingNo: 'DPK8765432109876' });
  });

  test('90秒超时终止请求并返回固定504错误', async () => {
    vi.useFakeTimers();
    const { service } = fixture();
    vi.mocked(fetch).mockImplementationOnce(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const rejection = expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(504, 'OCR_TIMEOUT'));
    await vi.advanceTimersByTimeAsync(90001);
    await rejection;
  });

  test('全局最多两个请求且同一账号不重复占用识别资源', async () => {
    const { service } = fixture();
    vi.mocked(fetch).mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const first = new AbortController();
    const second = new AbortController();
    const pending = [
      service.recognize(requestFor(), attachmentId, first.signal),
      service.recognize(requestFor(randomUUID()), attachmentId, second.signal),
    ];
    const settled = Promise.allSettled(pending);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(429, 'OCR_BUSY'));
    await expect(
      service.recognize(requestFor(randomUUID()), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(429, 'OCR_BUSY'));
    first.abort();
    second.abort();
    expect((await settled).every((item) => item.status === 'rejected')).toBe(true);
  });

  test.each([429, 500, 401])('内部HTTP %i 映射公开错误且不透传响应内容', async (upstreamStatus) => {
    const { service } = fixture();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('secret traceback', { status: upstreamStatus }),
    );
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(
      status(
        upstreamStatus === 429 ? 429 : 503,
        upstreamStatus === 429 ? 'OCR_BUSY' : 'OCR_UNAVAILABLE',
      ),
    );
  });

  test('上游504保留识别超时状态且不透传内部响应', async () => {
    const { service } = fixture();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('private upstream traceback', { status: 504 }),
    );
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject({
      ...status(504, 'OCR_TIMEOUT'),
      message: '识别超时，请重试或手动填写',
    });
  });

  test('连接失败与无效响应均为503且无内部错误文字', async () => {
    const { service } = fixture();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('private host detail'));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject({
      ...status(503, 'OCR_UNAVAILABLE'),
      message: '识别服务暂不可用，请稍后重试',
    });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ lines: [{ text: 'raw text' }] }));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(503, 'OCR_UNAVAILABLE'));
  });

  test('识别期间客户转交或附件删除后不返回候选', async () => {
    const { service, waybills } = fixture();
    waybills.accessible
      .mockResolvedValueOnce(file)
      .mockImplementationOnce(async () => fail('运单附件不可用', 404, 'NOT_FOUND'));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).rejects.toMatchObject(status(404, 'NOT_FOUND'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('识别期间会话撤销、角色或改密状态变化后不返回候选', async () => {
    for (const change of ['session', 'role', 'password']) {
      const { service, auth } = fixture();
      if (change === 'session')
        auth.authenticate.mockImplementation(async () => fail('登录已失效', 401, 'UNAUTHORIZED'));
      else
        auth.authenticate.mockResolvedValue({
          ...user,
          role: change === 'role' ? 'BOSS' : user.role,
          mustChangePassword: change === 'password',
        });
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(result));
      await expect(
        service.recognize(requestFor(), attachmentId, new AbortController().signal),
      ).rejects.toMatchObject(status(401, 'UNAUTHORIZED'));
    }
  });

  test('空结果或低置信行不会被拼接成号码', async () => {
    const { service } = fixture();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ ...result, lines: [{ ...result.lines[0], score: 0.2 }] }),
    );
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).resolves.toEqual({ carrier: undefined, trackingNo: undefined });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...result, lines: [] }));
    await expect(
      service.recognize(requestFor(), attachmentId, new AbortController().signal),
    ).resolves.toEqual({ carrier: undefined, trackingNo: undefined });
  });
});

describe('运单识别控制器边界', () => {
  test('拒绝客户端提供URL或文件路径', async () => {
    const recognition = { recognize: vi.fn() };
    const controller = new WaybillController({} as never, recognition as never);
    for (const body of [{ url: 'https://example.invalid/file' }, { path: 'D:\\private.png' }]) {
      await expect(
        controller.recognize({} as never, attachmentId, body, {} as never),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(recognition.recognize).not.toHaveBeenCalled();
  });

  test('响应连接提前关闭时取消上游请求并清除监听器', async () => {
    const request = Object.assign(new EventEmitter(), requestFor());
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const recognition = {
      recognize: vi.fn(
        async (_request, _id, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            );
          }),
      ),
    };
    const controller = new WaybillController({} as never, recognition as never);
    const rejection = expect(
      controller.recognize(request as never, attachmentId, undefined, response as never),
    ).rejects.toMatchObject({ name: 'AbortError' });
    response.emit('close');
    await rejection;
    expect(request.listenerCount('aborted')).toBe(0);
    expect(response.listenerCount('close')).toBe(0);
  });
});
