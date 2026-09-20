import { QueryClient } from '@tanstack/react-query';
import { validationMessage } from './labels';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = '';
export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function api<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (init?.method && !['GET', 'HEAD'].includes(init.method))
    headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api/v1${path}`, { ...init, credentials: 'include', headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = validationMessage(body);
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me')
      window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(
      response.status,
      message ||
        (response.status === 404
          ? '记录不可用'
          : response.status === 409
            ? '记录已更新'
            : '操作失败，请重试'),
      body,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function post<T = Record<string, unknown>>(path: string, body: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
export function patch<T = Record<string, unknown>>(path: string, body: unknown) {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
export function queryString(values: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== '' && value !== undefined && value !== null) query.set(key, String(value));
  return query.toString();
}

export function fileUrl(path: string) {
  return `/api/v1${path}`;
}

export function upload<T>(
  path: string,
  form: FormData,
  progress: (value: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/v1${path}`);
    request.withCredentials = true;
    request.setRequestHeader('X-CSRF-Token', csrfToken);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new ApiError(0, '上传失败，请重试'));
    request.onabort = () => reject(new ApiError(0, '已取消'));
    request.onload = () => {
      let body;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = {};
      }
      if (request.status >= 200 && request.status < 300) resolve(body);
      else reject(new ApiError(request.status, validationMessage(body) || '上传失败'));
    };
    signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(form);
  });
}
