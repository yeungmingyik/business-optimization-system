import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { access, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { DatabaseService } from '../apps/api/src/database.service';
import { WaybillService } from '../apps/api/src/waybills/waybill.service';
import { ApiClient, apiUrl, testPassword } from './api-client';
import { baselineJpeg } from './waybill-fixtures';

const owner = new ApiClient();
const operator = new ApiClient();
const suffix = randomUUID().replaceAll('-', '');
const cleanupSchema = `waybill_boundary_${suffix}`;
const uploadRoot = resolve(process.env.BOS_ROOT ?? process.cwd(), '.data/test-uploads');
const webp = readFileSync(new URL('./fixtures/waybills/synthetic.webp', import.meta.url));
const maxBytes = 10 * 1024 * 1024;
const ownedFiles = new Set<string>();
let database: DatabaseService | undefined;
let cleanupService: WaybillService | undefined;
let customer: any;
let product: any;

function ok(response: any) {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
}

function filePath(key: string) {
  if (!/^[a-f0-9-]{36}\.upload$/.test(key)) throw new Error('INVALID_TEST_STORAGE_KEY');
  const path = resolve(uploadRoot, key);
  if (!path.startsWith(`${uploadRoot}${sep}`)) throw new Error('INVALID_TEST_STORAGE_PATH');
  return path;
}

async function raw(method: string, path: string, body?: FormData) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      cookie: operator.cookie,
      'x-csrf-token': operator.csrfToken,
      origin: 'http://127.0.0.1:5174',
    },
    body,
  });
}

async function upload(bytes = webp, name = '边界运单.webp', type = 'image/webp') {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), name);
  const response = await raw('POST', '/waybills', form);
  const body = await response.json();
  if (response.ok) {
    const row = await attachmentRow(body.id);
    ownedFiles.add(filePath(row.storage_key));
  }
  return { status: response.status, body };
}

async function attachmentRow(id: string) {
  const result = await database!.query(
    'SELECT * FROM public.waybill_attachments WHERE id=$1 AND uploader_id=$2',
    [id, operator.user.id],
  );
  expect(result.rowCount).toBe(1);
  return result.rows[0];
}

async function attachmentCount() {
  const result = await database!.query(
    'SELECT count(*)::int AS count FROM public.waybill_attachments WHERE uploader_id=$1',
    [operator.user.id],
  );
  return result.rows[0].count;
}

function orderInput(ids: string[]) {
  return {
    customerId: customer.id,
    orderDate: '2026-09-22',
    recipientName: '附件边界客户',
    recipientPhone: '13800000000',
    recipientAddress: '附件边界测试地址',
    lines: [{ productId: product.id, quantity: 1, unitPriceExTax: '10.00' }],
    shipments: [
      { id: randomUUID(), carrier: '', trackingNo: '', freightPayment: '到付', attachmentIds: ids },
    ],
  };
}

beforeAll(async () => {
  if (!/^D:[\\/]/i.test(uploadRoot) || !process.env.BOS_TEST_DB_PASSWORD)
    throw new Error('D_DRIVE_TEST_DATABASE_REQUIRED');
  for (const [key, value] of Object.entries({
    PGHOST: '127.0.0.1',
    PGPORT: '54322',
    PGDATABASE: 'business_test',
    PGUSER: 'business_test',
    PGPASSWORD: process.env.BOS_TEST_DB_PASSWORD,
    BOS_UPLOAD_ROOT: uploadRoot,
  }))
    vi.stubEnv(key, value);
  database = new DatabaseService();
  const target = await database.query('SELECT current_database() AS name, current_user AS user');
  expect(target.rows[0]).toEqual({ name: 'business_test', user: 'business_test' });
  await owner.login('test-owner', 'TestOwner2026!Local');
  const loginName = `waybill-boundary-${suffix.slice(0, 12)}`;
  const created = ok(
    await owner.request('POST', '/users', { loginName, displayName: loginName, role: 'OPERATOR' }),
  );
  await operator.login(loginName, created.temporaryPassword);
  ok(
    await operator.request('POST', '/auth/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: testPassword,
    }),
  );
  await operator.login(loginName, testPassword);
  const merchant = ok(
    await owner.request('POST', '/merchant-accounts', {
      name: `附件边界账号${suffix.slice(0, 12)}`,
      platform: '微信',
    }),
  );
  customer = ok(
    await operator.request('POST', '/customers', {
      contactName: `附件边界客户${suffix.slice(0, 12)}`,
      merchantAccountId: merchant.id,
      sourceChannel: '微信',
    }),
  );
  product = ok(
    await operator.request('POST', '/products', {
      sku: `WB-BOUNDARY-${suffix.slice(0, 12)}`,
      name: '附件边界产品',
      priceExTax: '10.00',
    }),
  );
  await database.query(`CREATE SCHEMA "${cleanupSchema}"`);
  if (!/^[a-f0-9-]{36}$/.test(operator.user.id)) throw new Error('INVALID_TEST_UPLOADER');
  await database.query(
    `CREATE VIEW "${cleanupSchema}".waybill_attachments AS
     SELECT * FROM public.waybill_attachments WHERE uploader_id='${operator.user.id}'::uuid
     WITH LOCAL CHECK OPTION`,
  );
  cleanupService = new WaybillService({
    transaction: (operation: Parameters<DatabaseService['transaction']>[0]) =>
      database!.transaction(async (tx) => {
        await tx.query(`SET LOCAL search_path TO "${cleanupSchema}",public`);
        return operation(tx);
      }),
  } as DatabaseService);
});

afterEach(async () => {
  cleanupService?.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (!database || !operator.user) return;
  const removed = await database.query(
    'DELETE FROM public.waybill_attachments WHERE uploader_id=$1 RETURNING storage_key',
    [operator.user.id],
  );
  for (const row of removed.rows) ownedFiles.add(filePath(row.storage_key));
  for (const path of ownedFiles)
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  ownedFiles.clear();
});

afterAll(async () => {
  if (database) {
    try {
      await database.query(`DROP VIEW IF EXISTS "${cleanupSchema}".waybill_attachments`);
      await database.query(`DROP SCHEMA IF EXISTS "${cleanupSchema}"`);
    } finally {
      await database.onModuleDestroy();
    }
  }
  vi.unstubAllEnvs();
});

test('WebP真实上传保持媒体类型、尺寸、中文文件名与下载字节', async () => {
  const attachment = ok(await upload());
  expect(attachment).toMatchObject({
    name: '边界运单.webp',
    mediaType: 'image/webp',
    width: 96,
    height: 48,
    bytes: webp.length,
    pending: true,
  });
  const response = await raw('GET', `/waybills/${attachment.id}/content`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('image/webp');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(webp);
  const row = await attachmentRow(attachment.id);
  expect(await readFile(filePath(row.storage_key))).toEqual(webp);
});

test('恰好10MiB的JPEG上传及下载成功', async () => {
  const bytes = Buffer.alloc(maxBytes);
  baselineJpeg.copy(bytes);
  const attachment = ok(await upload(bytes, '10MiB.jpg', 'image/jpeg'));
  expect(attachment.bytes).toBe(maxBytes);
  const response = await raw('GET', `/waybills/${attachment.id}/content`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-length')).toBe(String(maxBytes));
  const downloaded = Buffer.from(await response.arrayBuffer());
  expect(downloaded.length).toBe(bytes.length);
  expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
});

test('超过10MiB一字节返回413且不遗留记录或上传文件', async () => {
  const bytes = Buffer.alloc(maxBytes + 1);
  baselineJpeg.copy(bytes);
  const before = (await readdir(uploadRoot)).sort();
  expect((await upload(bytes, '10MiB-plus-one.jpg', 'image/jpeg')).status).toBe(413);
  expect(await attachmentCount()).toBe(0);
  expect((await readdir(uploadRoot)).sort()).toEqual(before);
});

test('单条物流允许5张附件，拒绝第6张且保持原订单和附件绑定', async () => {
  const attachments = [];
  for (let index = 0; index < 6; index += 1) attachments.push(ok(await upload()));
  const ids = attachments.map((attachment) => attachment.id);
  expect((await operator.request('POST', '/orders', orderInput(ids))).status).toBe(422);
  const order = ok(await operator.request('POST', '/orders', orderInput(ids.slice(0, 5))));
  expect(order.shipments[0].attachmentIds).toEqual(ids.slice(0, 5));
  expect(
    (
      await operator.request('PATCH', `/orders/${order.id}/shipments/${order.shipments[0].id}`, {
        version: order.version,
        attachmentIds: ids,
      })
    ).status,
  ).toBe(422);
  const unchanged = ok(await operator.request('GET', `/orders/${order.id}`));
  expect(unchanged.version).toBe(order.version);
  expect(unchanged.shipments[0].attachmentIds).toEqual(ids.slice(0, 5));
  for (const id of ids.slice(0, 5)) expect((await attachmentRow(id)).order_id).toBe(order.id);
  expect((await attachmentRow(ids[5])).order_id).toBeNull();
});

test('待保存附件30张达到上限，第31张拒绝，绑定订单后可继续上传', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 30; index += 1) ids.push(ok(await upload()).id);
  expect(await attachmentCount()).toBe(30);
  const before = (await readdir(uploadRoot)).sort();
  const overflow = await upload();
  expect(overflow.status).toBe(422);
  expect(overflow.body.message).toContain('待保存的运单图片过多');
  expect(await attachmentCount()).toBe(30);
  expect((await readdir(uploadRoot)).sort()).toEqual(before);
  ok(await operator.request('POST', '/orders', orderInput([ids[0]])));
  expect(ok(await upload()).pending).toBe(true);
  expect(await attachmentCount()).toBe(31);
});

test('删除API立即撤销访问并回收本测试附件物理文件', async () => {
  const attachment = ok(await upload());
  const path = filePath((await attachmentRow(attachment.id)).storage_key);
  const guard = await database!.pool.connect();
  try {
    await guard.query('BEGIN');
    await guard.query(
      `SELECT id FROM public.waybill_attachments WHERE uploader_id<>$1 AND
       (deleted_at IS NOT NULL OR (order_id IS NULL AND created_at<now()-interval '24 hours'))
       FOR UPDATE`,
      [operator.user.id],
    );
    ok(await operator.request('DELETE', `/waybills/${attachment.id}`));
    expect((await raw('GET', `/waybills/${attachment.id}/content`)).status).toBe(404);
    await vi.waitFor(async () => {
      await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await attachmentCount()).toBe(0);
    });
  } finally {
    await guard.query('ROLLBACK');
    guard.release();
  }
});

test('每小时定时清理过期及已删除附件，保留未过期与已绑定附件', async () => {
  const attachments = [];
  for (let index = 0; index < 6; index += 1) attachments.push(ok(await upload()));
  const [expired, deleted, removedBound, activeBound, fresh, missingFile] = attachments;
  const files = new Map<string, string>();
  for (const attachment of attachments)
    files.set(attachment.id, filePath((await attachmentRow(attachment.id)).storage_key));
  let order = ok(
    await operator.request('POST', '/orders', orderInput([removedBound.id, activeBound.id])),
  );
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const cleanup = vi.spyOn(cleanupService!, 'cleanup');
  cleanupService!.onModuleInit();
  expect(cleanup).toHaveBeenCalledTimes(1);
  await cleanup.mock.results[0].value;
  expect(await attachmentCount()).toBe(6);
  order = ok(
    await operator.request('PATCH', `/orders/${order.id}/shipments/${order.shipments[0].id}`, {
      version: order.version,
      attachmentIds: [activeBound.id],
    }),
  );
  await database!.query(
    `UPDATE public.waybill_attachments SET created_at=now()-interval '25 hours'
     WHERE uploader_id=$1 AND id=ANY($2::uuid[])`,
    [operator.user.id, [expired.id, activeBound.id, missingFile.id]],
  );
  await database!.query(
    `UPDATE public.waybill_attachments SET created_at=now()-interval '23 hours'
     WHERE uploader_id=$1 AND id=$2`,
    [operator.user.id, fresh.id],
  );
  await database!.query(
    'UPDATE public.waybill_attachments SET deleted_at=now() WHERE uploader_id=$1 AND id=$2',
    [operator.user.id, deleted.id],
  );
  await unlink(files.get(missingFile.id)!);
  expect((await operator.request('GET', `/waybills/${expired.id}`)).status).toBe(404);
  expect((await operator.request('GET', `/waybills/${deleted.id}`)).status).toBe(404);
  vi.advanceTimersByTime(3599999);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(access(files.get(expired.id)!)).resolves.toBeUndefined();
  vi.advanceTimersByTime(1);
  expect(cleanup).toHaveBeenCalledTimes(2);
  await cleanup.mock.results[1].value;
  for (const attachment of [expired, deleted, removedBound, missingFile]) {
    await expect(access(files.get(attachment.id)!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (
        await database!.query('SELECT id FROM public.waybill_attachments WHERE id=$1', [
          attachment.id,
        ])
      ).rowCount,
    ).toBe(0);
  }
  for (const attachment of [activeBound, fresh]) {
    expect(await readFile(files.get(attachment.id)!)).toEqual(webp);
    expect((await operator.request('GET', `/waybills/${attachment.id}`)).status).toBe(200);
  }
  expect(await attachmentCount()).toBe(2);
  expect((await attachmentRow(activeBound.id)).order_id).toBe(order.id);
  cleanupService!.onModuleDestroy();
  vi.advanceTimersByTime(3600000);
  expect(cleanup).toHaveBeenCalledTimes(2);
});
