import { api } from './api';

export type WaybillRecognition = { carrier?: string; trackingNo?: string };

export async function recognizeWaybill(
  id: string,
  signal: AbortSignal,
): Promise<WaybillRecognition> {
  signal.throwIfAborted();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 90000);
  try {
    return await api<WaybillRecognition>(`/waybills/${encodeURIComponent(id)}/recognize`, {
      method: 'POST',
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error('识别超时，请重试或手动填写');
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
