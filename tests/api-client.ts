export const apiUrl = 'http://127.0.0.1:3001/api/v1';
export const testPassword = 'Operator2026!Local';

export class ApiClient {
  cookie = '';
  csrfToken = '';
  user: any;

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: this.cookie,
        'x-csrf-token': this.csrfToken,
        origin: 'http://127.0.0.1:5174',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = response.status === 204 ? null : await response.json();
    return { status: response.status, body: result, headers: response.headers };
  }

  async login(loginName: string, password: string) {
    const response = await this.request('POST', '/auth/login', { loginName, password });
    if (response.status !== 200 && response.status !== 201)
      throw new Error(`LOGIN_FAILED:${response.status}:${JSON.stringify(response.body)}`);
    this.csrfToken = response.body.csrfToken;
    this.user = response.body.user;
    return response;
  }
}
