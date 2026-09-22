import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, testPassword } from './api-client';

const requireApi = createRequire(resolve('apps/api/package.json'));
const { Pool } = requireApi('pg');
const database = new Pool({
  host: '127.0.0.1',
  port: 54322,
  database: 'business_test',
  user: 'business_test',
  password: process.env.BOS_TEST_DB_PASSWORD,
  max: 2,
});
const boss = new ApiClient();
const operator = new ApiClient();
const loginName = `security-${Date.now().toString(36)}`;
const tokenHash = (client: ApiClient) =>
  createHash('sha256').update(client.cookie.split('=')[1]).digest('hex');
const successful = (response: any) => {
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
};

beforeAll(async () => {
  expect(process.env.BOS_TEST_DB_PASSWORD).toBeTruthy();
  expect((await database.query('SELECT current_database() AS name')).rows[0].name).toBe(
    'business_test',
  );
  await boss.login('test-owner', 'TestOwner2026!Local');
  const user = successful(
    await boss.request('POST', '/users', {
      loginName,
      displayName: '权限测试运营',
      role: 'OPERATOR',
    }),
  );
  await operator.login(loginName, user.temporaryPassword);
  successful(
    await operator.request('POST', '/auth/change-password', {
      currentPassword: user.temporaryPassword,
      newPassword: testPassword,
    }),
  );
  await operator.login(loginName, testPassword);
});

afterAll(async () => {
  await database.end();
});

describe('会话与并发保护', () => {
  it('闲置期限到达后必须重新登录', async () => {
    const session = new ApiClient();
    await session.login(loginName, testPassword);
    await database.query(
      "UPDATE sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
      [tokenHash(session)],
    );
    expect((await session.request('GET', '/auth/me')).status).toBe(401);
    expect((await operator.request('GET', '/auth/me')).status).toBe(200);
  });

  it('持续活动不能延长绝对会话期限', async () => {
    const session = new ApiClient();
    await session.login(loginName, testPassword);
    await database.query(
      "UPDATE sessions SET created_at=now()-interval '721 minutes',last_seen_at=now() WHERE token_hash=$1",
      [tokenHash(session)],
    );
    expect((await session.request('GET', '/auth/me')).status).toBe(401);
  });

  it('缺失账号和错误密码返回同样的公开错误', async () => {
    const unknown = await new ApiClient().request('POST', '/auth/login', {
      loginName: `${loginName}-absent`,
      password: testPassword,
    });
    const incorrect = await new ApiClient().request('POST', '/auth/login', {
      loginName,
      password: 'InvalidPassword999',
    });
    expect(unknown.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(unknown.body.code).toBe(incorrect.body.code);
    expect(unknown.body.message).toBe(incorrect.body.message);
    expect(JSON.stringify(unknown.body)).not.toMatch(/stack|argon2|password_hash/);
  });

  it('重置密码同时撤销所有旧会话', async () => {
    const second = new ApiClient();
    await second.login(loginName, testPassword);
    const users = successful(await boss.request('GET', `/users?q=${loginName}`));
    const current = users.items[0];
    const reset = successful(
      await boss.request('POST', `/users/${current.id}/reset-password`, {
        version: current.version,
      }),
    );
    expect((await operator.request('GET', '/auth/me')).status).toBe(401);
    expect((await second.request('GET', '/auth/me')).status).toBe(401);
    expect(
      (await new ApiClient().request('POST', '/auth/login', { loginName, password: testPassword }))
        .status,
    ).toBe(401);
    await operator.login(loginName, reset.temporaryPassword);
    expect(operator.user.mustChangePassword).toBe(true);
    successful(
      await operator.request('POST', '/auth/change-password', {
        currentPassword: reset.temporaryPassword,
        newPassword: testPassword,
      }),
    );
    await operator.login(loginName, testPassword);
  });

  it('角色变更撤销旧会话，重新登录恢复正确权限', async () => {
    const users = successful(await boss.request('GET', `/users?q=${loginName}`));
    const changed = successful(
      await boss.request('PATCH', `/users/${operator.user.id}`, {
        version: users.items[0].version,
        role: 'BOSS',
      }),
    );
    expect((await operator.request('GET', '/users')).status).toBe(401);
    await operator.login(loginName, testPassword);
    expect((await operator.request('GET', '/users')).status).toBe(200);
    successful(
      await boss.request('PATCH', `/users/${operator.user.id}`, {
        version: changed.version,
        role: 'OPERATOR',
      }),
    );
    expect((await operator.request('GET', '/users')).status).toBe(401);
    await operator.login(loginName, testPassword);
    expect((await operator.request('GET', '/users')).status).toBe(403);
  });

  it('同一订单并发付款与取消只允许一项成功', async () => {
    const merchant = successful(
      await boss.request('POST', '/merchant-accounts', {
        name: `并发-${loginName}`,
        platform: '微信',
      }),
    );
    const customer = successful(
      await operator.request('POST', '/customers', {
        contactName: '并发客户',
        merchantAccountId: merchant.id,
        sourceChannel: '微信',
      }),
    );
    const product = successful(
      await operator.request('POST', '/products', {
        sku: `race-${loginName}`,
        name: '并发产品',
        priceExTax: '19.90',
      }),
    );
    const order = successful(
      await operator.request('POST', '/orders', {
        customerId: customer.id,
        orderDate: '2026-09-01',
        recipientName: '收货人',
        recipientPhone: '13800000000',
        recipientAddress: '地址',
        lines: [{ productId: product.id, quantity: 2, unitPriceExTax: '19.90' }],
      }),
    );
    const attempts = await Promise.all([
      operator.request('POST', `/orders/${order.id}/payment`, {
        version: order.version,
        paidAt: new Date().toISOString(),
        receivingAccount: '工商银行 622200001234',
        paymentNote: '银行转账',
      }),
      operator.request('POST', `/orders/${order.id}/cancel`, {
        version: order.version,
        reason: '取消采购',
      }),
    ]);
    expect(attempts.filter((response) => response.status < 300)).toHaveLength(1);
    expect(attempts.filter((response) => response.status >= 400)).toHaveLength(1);
    const payments = await database.query(
      'SELECT count(*)::int AS count FROM payment_changes WHERE order_id=$1',
      [order.id],
    );
    expect(payments.rows[0].count).toBe(1);
  });
});
