import { randomUUID } from 'node:crypto';
import { beforeAll, expect, test } from 'vitest';
import { ApiClient, apiUrl, testPassword } from './api-client';
import { invalidJpegs, jpegFixtures } from './waybill-fixtures';

const boss = new ApiClient();
const operator = new ApiClient();
const colleague = new ApiClient();
const suffix = randomUUID().slice(0, 8);
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=',
  'base64',
);
let customer: any;
let product: any;

function ok(response: any) {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
}

async function raw(client: ApiClient, method: string, path: string, body?: FormData) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      cookie: client.cookie,
      'x-csrf-token': client.csrfToken,
      origin: 'http://127.0.0.1:5174',
    },
    body,
  });
}

async function upload(client: ApiClient, bytes = image, name = 'waybill.png', type = 'image/png') {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), name);
  const response = await raw(client, 'POST', '/waybills', form);
  return { status: response.status, body: await response.json() };
}

function orderInput(ids: string[], overrides: Record<string, unknown> = {}) {
  return {
    customerId: customer.id,
    orderDate: '2026-09-22',
    recipientName: '运单客户',
    recipientPhone: '13800000000',
    recipientAddress: '运单地址',
    lines: [{ productId: product.id, quantity: 1, unitPriceExTax: '10.00' }],
    shipments: [
      { id: randomUUID(), carrier: '', trackingNo: '', freightPayment: '到付', attachmentIds: ids },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  await boss.login('test-owner', 'TestOwner2026!Local');
  for (const [client, name] of [
    [operator, 'a'],
    [colleague, 'b'],
  ] as const) {
    const loginName = `waybill-${name}-${suffix}`;
    const created = ok(
      await boss.request('POST', '/users', { loginName, displayName: loginName, role: 'OPERATOR' }),
    );
    await client.login(loginName, created.temporaryPassword);
    ok(
      await client.request('POST', '/auth/change-password', {
        currentPassword: created.temporaryPassword,
        newPassword: testPassword,
      }),
    );
    await client.login(loginName, testPassword);
  }
  const merchant = ok(
    await boss.request('POST', '/merchant-accounts', {
      name: `运单账号${suffix}`,
      platform: '微信',
    }),
  );
  customer = ok(
    await operator.request('POST', '/customers', {
      contactName: `运单客户${suffix}`,
      merchantAccountId: merchant.id,
      sourceChannel: '微信',
    }),
  );
  product = ok(
    await operator.request('POST', '/products', {
      sku: `WB-${suffix}`,
      name: '运单产品',
      priceExTax: '10.00',
    }),
  );
});

test('运单上传校验类型、签名、尺寸、文件大小与认证', async () => {
  expect((await upload(new ApiClient())).status).toBe(401);
  for (const [bytes, name, type] of [
    [Buffer.from('<svg></svg>'), 'bad.svg', 'image/svg+xml'],
    [Buffer.from('not a real image'), 'bad.png', 'image/png'],
    [image, 'wrong.jpg', 'image/jpeg'],
    [image, 'wrong.png', 'text/plain'],
  ] as const)
    expect((await upload(operator, bytes, name, type)).status).toBe(422);
  const oversized = Buffer.from(image);
  oversized.writeUInt32BE(11000, 16);
  expect((await upload(operator, oversized)).status).toBe(422);
  expect((await upload(operator, Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
  for (const { name, bytes } of invalidJpegs)
    expect((await upload(operator, bytes, name, 'image/jpeg')).status).toBe(422);
});

test.each(jpegFixtures)('JPEG $name 上传、授权读取和删除', async ({ name, bytes }) => {
  const attachment = ok(await upload(operator, bytes, name, 'image/jpeg'));
  try {
    expect(attachment).toMatchObject({
      name,
      pending: true,
      width: 1200,
      height: 380,
      mediaType: 'image/jpeg',
    });
    const download = await raw(operator, 'GET', `/waybills/${attachment.id}/content`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('image/jpeg');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect((await raw(colleague, 'GET', `/waybills/${attachment.id}/content`)).status).toBe(404);
  } finally {
    ok(await operator.request('DELETE', `/waybills/${attachment.id}`));
  }
});

test('未绑定运单仅上传人可读、删除且不能被其他账号绑定', async () => {
  const attachment = ok(await upload(operator, image, '顺丰运单-林经理-交付园区.png'));
  expect(attachment.name).toBe('顺丰运单-林经理-交付园区.png');
  expect(attachment).toMatchObject({ pending: true, width: 1, height: 1, mediaType: 'image/png' });
  expect(attachment.storageKey).toBeUndefined();
  for (const client of [boss, colleague]) {
    expect((await client.request('GET', `/waybills/${attachment.id}`)).status).toBe(404);
    expect((await raw(client, 'GET', `/waybills/${attachment.id}/content`)).status).toBe(404);
    expect((await client.request('DELETE', `/waybills/${attachment.id}`)).status).toBe(404);
    expect((await client.request('POST', `/waybills/${attachment.id}/recognize`)).status).toBe(404);
  }
  expect(
    (await new ApiClient().request('POST', `/waybills/${attachment.id}/recognize`)).status,
  ).toBe(401);
  expect(
    (
      await operator.request(
        'POST',
        `/waybills/${attachment.id}/recognize`,
        {},
        { 'x-csrf-token': '' },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await operator.request('POST', `/waybills/${attachment.id}/recognize`, {
        path: 'D:\\private.png',
      })
    ).status,
  ).toBe(422);
  expect((await boss.request('POST', '/orders', orderInput([attachment.id]))).status).toBe(404);
  const download = await raw(operator, 'GET', `/waybills/${attachment.id}/content`);
  expect(download.status).toBe(200);
  expect(download.headers.get('cache-control')).toBe('private, no-store');
  expect(download.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await download.arrayBuffer())).toEqual(image);
  ok(await operator.request('DELETE', `/waybills/${attachment.id}`));
  expect((await operator.request('GET', `/waybills/${attachment.id}`)).status).toBe(404);
});

test('运单随订单授权、阻止重复及跨订单复用、物流局部更新保留附件', async () => {
  const attachment = ok(await upload(operator));
  expect(
    (await operator.request('POST', '/orders', orderInput([attachment.id, attachment.id]))).status,
  ).toBe(422);
  let order = ok(await operator.request('POST', '/orders', orderInput([attachment.id])));
  expect(order.shipments[0].attachmentIds).toEqual([attachment.id]);
  expect((await boss.request('GET', `/waybills/${attachment.id}`)).status).toBe(200);
  expect((await colleague.request('GET', `/waybills/${attachment.id}`)).status).toBe(404);
  expect((await operator.request('DELETE', `/waybills/${attachment.id}`)).status).toBe(404);
  expect((await operator.request('POST', '/orders', orderInput([attachment.id]))).status).toBe(404);
  order = ok(
    await operator.request('PATCH', `/orders/${order.id}/shipments/${order.shipments[0].id}`, {
      version: order.version,
      trackingNo: 'SF1234567890123',
    }),
  );
  expect(order.shipments[0].attachmentIds).toEqual([attachment.id]);
  ok(
    await boss.request('POST', `/customers/${customer.id}/assign`, {
      version: customer.version,
      ownerId: colleague.user.id,
    }),
  );
  expect((await raw(operator, 'GET', `/waybills/${attachment.id}/content`)).status).toBe(404);
  expect((await operator.request('POST', `/waybills/${attachment.id}/recognize`)).status).toBe(404);
  expect((await raw(colleague, 'GET', `/waybills/${attachment.id}/content`)).status).toBe(200);
  order = ok(await colleague.request('GET', `/orders/${order.id}`));
  order = ok(
    await colleague.request('PATCH', `/orders/${order.id}/shipments/${order.shipments[0].id}`, {
      version: order.version,
      carrier: '顺丰速运',
      attachmentIds: [],
    }),
  );
  expect(order.shipments[0].attachmentIds).toEqual([]);
  for (const client of [operator, colleague, boss])
    expect((await client.request('GET', `/waybills/${attachment.id}`)).status).toBe(404);
});
