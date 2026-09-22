import { beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { ApiClient, apiUrl, testPassword } from './api-client';
import { importColumns, XLSX_MIME } from '../apps/api/src/transfer/transfer.types';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const ExcelJS = apiRequire('exceljs');
const boss = new ApiClient();
const operator = new ApiClient();
const colleague = new ApiClient();
const suffix = randomUUID().slice(0, 8);
let merchant: any;
let customer: any;
let product: any;

async function raw(
  client: ApiClient,
  method: string,
  path: string,
  body?: FormData,
  extra: Record<string, string> = {},
) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      cookie: client.cookie,
      'x-csrf-token': client.csrfToken,
      origin: 'http://127.0.0.1:5174',
      ...extra,
    },
    body,
  });
}

async function upload(
  client: ApiClient,
  path: string,
  bytes: Uint8Array,
  name: string,
  type: string,
  fields: Record<string, string>,
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  body.set('file', new Blob([bytes as BlobPart], { type }), name);
  const response = await raw(client, 'POST', path, body);
  return { status: response.status, body: await response.json() };
}

async function workbook(kind: keyof typeof importColumns, rows: Record<string, unknown>[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('数据');
  sheet.columns = Object.entries(importColumns[kind]).map(([key, header]) => ({ key, header }));
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function poll(client: ApiClient, path: string) {
  for (let index = 0; index < 120; index += 1) {
    const response = await client.request('GET', path);
    expect(response.status).toBe(200);
    if (['SUCCEEDED', 'FAILED'].includes(response.body.status)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('TASK_TIMEOUT');
}

async function createOperator(client: ApiClient, name: string) {
  const response = await boss.request('POST', '/users', {
    loginName: name,
    displayName: name,
    role: 'OPERATOR',
  });
  expect(response.status).toBe(201);
  await client.login(name, response.body.temporaryPassword);
  const password = await client.request('POST', '/auth/change-password', {
    currentPassword: response.body.temporaryPassword,
    newPassword: testPassword,
  });
  expect([200, 201]).toContain(password.status);
  await client.login(name, testPassword);
}

beforeAll(async () => {
  await boss.login('test-owner', 'TestOwner2026!Local');
  await createOperator(operator, `transfer-a-${suffix}`);
  await createOperator(colleague, `transfer-b-${suffix}`);
  const account = await boss.request('POST', '/merchant-accounts', {
    name: `资料测试${suffix}`,
    platform: '微信',
  });
  expect(account.status).toBe(201);
  merchant = account.body;
  const createdProduct = await operator.request('POST', '/products', {
    sku: `TR-${suffix}`,
    name: '测试产品',
    priceExTax: '10.20',
  });
  expect(createdProduct.status).toBe(201);
  product = createdProduct.body;
  const createdCustomer = await operator.request('POST', '/customers', {
    contactName: `文件客户${suffix}`,
    merchantAccountId: merchant.id,
    sourceChannel: '微信',
  });
  expect(createdCustomer.status).toBe(201);
  customer = createdCustomer.body;
});

describe('资料库', () => {
  const image = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7sAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  test('共享编辑、版本、Range、归档与下载鉴权', async () => {
    const created = await upload(operator, '/assets', image, 'product.png', 'image/png', {
      metadata: JSON.stringify({ name: `产品资料${suffix}`, productIds: [product.id] }),
    });
    expect(created.status).toBe(201);
    const asset = created.body;
    expect(asset.versions).toHaveLength(1);
    const replaced = await upload(
      colleague,
      `/assets/${asset.id}/versions`,
      image,
      'updated.png',
      'image/png',
      { version: String(asset.version) },
    );
    expect(replaced.status).toBe(201);
    expect(replaced.body.versions).toHaveLength(2);
    const outdated = await colleague.request('PATCH', `/assets/${asset.id}`, {
      name: '已更新',
      version: asset.version,
    });
    expect(outdated.status).toBe(409);
    const old = await raw(
      operator,
      'GET',
      `/assets/${asset.id}/download?versionId=${asset.currentVersionId}`,
    );
    expect(old.status).toBe(200);
    expect(new Uint8Array(await old.arrayBuffer())).toEqual(image);
    const range = await raw(operator, 'GET', `/assets/${asset.id}/preview`, undefined, {
      range: 'bytes=0-7',
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-length')).toBe('8');
    expect((await range.arrayBuffer()).byteLength).toBe(8);
    expect(
      (
        await operator.request('POST', `/assets/${asset.id}/archive`, {
          version: replaced.body.version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await boss.request('POST', `/assets/${asset.id}/archive`, {
          version: replaced.body.version,
        })
      ).status,
    ).toBe(201);
    expect((await raw(operator, 'GET', `/assets/${asset.id}/download`)).status).toBe(403);
    const ownerDownload = await raw(boss, 'GET', `/assets/${asset.id}/download`);
    expect(ownerDownload.status).toBe(200);
    await ownerDownload.arrayBuffer();
    expect((await raw(new ApiClient(), 'GET', `/assets/${asset.id}/download`)).status).toBe(401);
  });

  test('拒绝伪装文件、脚本和无效资料元数据', async () => {
    const disguised = await upload(
      operator,
      '/assets',
      new TextEncoder().encode('%PDF-1.7 invalid png'),
      'test.png',
      'image/png',
      { metadata: JSON.stringify({ name: '伪装图片' }) },
    );
    expect(disguised.status).toBe(422);
    const executable = await upload(
      operator,
      '/assets',
      image,
      'test.exe',
      'application/octet-stream',
      { metadata: JSON.stringify({ name: '可执行文件' }) },
    );
    expect(executable.status).toBe(422);
    const malformed = await upload(operator, '/assets', image, 'test.png', 'image/png', {
      metadata: '{',
    });
    expect(malformed.status).toBe(422);
  });
});

describe('导入与导出', () => {
  test('模板中文列、预检不写、幂等提交、跨账号任务隔离', async () => {
    const templateResponse = await raw(operator, 'GET', '/import-templates/products');
    expect(templateResponse.status).toBe(200);
    const template = new ExcelJS.Workbook();
    await template.xlsx.load(await templateResponse.arrayBuffer());
    expect(template.getWorksheet('数据').getRow(1).getCell(1).value).toBe('产品编号');
    const sku = `IMP-${suffix}`;
    const bytes = await workbook('products', [
      { sku, name: '=HYPERLINK("https://invalid.example")', unit: '件', priceExTax: '1.25' },
    ]);
    const previewResponse = await upload(
      operator,
      '/imports/preview',
      bytes,
      'products.xlsx',
      XLSX_MIME,
      { kind: 'products' },
    );
    expect(previewResponse.status).toBe(201);
    const jobId = previewResponse.body.jobId;
    const preview = await poll(operator, `/imports/${jobId}`);
    expect(preview.status).toBe('SUCCEEDED');
    expect(preview.previewValid).toBe(true);
    expect(preview.expectedNew).toBe(1);
    expect(preview.filename).toBe('products.xlsx');
    expect(preview.actorId).toBe(operator.user.id);
    expect(preview.actorName).toBe(operator.user.displayName);
    expect(preview.canCommit).toBe(true);
    const tasks = await operator.request('GET', '/imports?kind=products&status=SUCCEEDED');
    expect(tasks.status).toBe(200);
    expect(tasks.body.items.some((item: any) => item.id === jobId)).toBe(true);
    expect(tasks.body.items.find((item: any) => item.id === jobId).canCommit).toBe(true);
    const bossTasks = await boss.request('GET', '/imports?kind=products&status=SUCCEEDED');
    expect(bossTasks.status).toBe(200);
    expect(bossTasks.body.items.find((item: any) => item.id === jobId)).toMatchObject({
      actorId: operator.user.id,
      actorName: operator.user.displayName,
      canCommit: false,
    });
    const bossFiltered = await boss.request('GET', `/imports?actorId=${operator.user.id}`);
    expect(bossFiltered.body.items.every((item: any) => item.actorId === operator.user.id)).toBe(
      true,
    );
    expect(bossFiltered.body.items.some((item: any) => item.id === jobId)).toBe(true);
    expect((await boss.request('GET', `/imports?actorId=${colleague.user.id}`)).body.total).toBe(0);
    const forgedActorFilter = await colleague.request(
      'GET',
      `/imports?actorId=${operator.user.id}`,
    );
    expect(forgedActorFilter.status).toBe(200);
    expect(forgedActorFilter.body.total).toBe(0);
    const bossDetails = await boss.request('GET', `/imports/${jobId}`);
    expect(bossDetails.status).toBe(200);
    expect(bossDetails.body).toMatchObject({
      actorId: operator.user.id,
      actorName: operator.user.displayName,
      canCommit: false,
    });
    expect(
      (await boss.request('POST', `/imports/${jobId}/commit`, { idempotencyKey: randomUUID() }))
        .status,
    ).toBe(403);
    expect((await operator.request('GET', `/products?q=${sku}`)).body.total).toBe(0);
    expect((await colleague.request('GET', `/imports/${jobId}`)).status).toBe(404);
    const idempotencyKey = randomUUID();
    expect(
      (await operator.request('POST', `/imports/${jobId}/commit`, { idempotencyKey })).status,
    ).toBe(201);
    const committed = await poll(operator, `/imports/${jobId}`);
    expect(committed.status).toBe('SUCCEEDED');
    expect(committed.phase).toBe('COMMIT');
    expect(committed.createdCount).toBe(1);
    expect(committed.committedAt).toBeTruthy();
    expect(committed.canCommit).toBe(false);
    expect(
      (await operator.request('POST', `/imports/${jobId}/commit`, { idempotencyKey })).status,
    ).toBe(201);
    const repeated = await upload(operator, '/imports/preview', bytes, 'products.xlsx', XLSX_MIME, {
      kind: 'products',
    });
    expect(repeated.body.jobId).toBe(jobId);
    const otherBytes = await workbook('products', [
      { sku: `OTHER-${suffix}`, name: '另一批产品', unit: '件', priceExTax: '2.50' },
    ]);
    const otherBatch = await upload(
      operator,
      '/imports/preview',
      otherBytes,
      'other-products.xlsx',
      XLSX_MIME,
      { kind: 'products' },
    );
    expect((await poll(operator, `/imports/${otherBatch.body.jobId}`)).previewValid).toBe(true);
    expect(
      (
        await operator.request('POST', `/imports/${otherBatch.body.jobId}/commit`, {
          idempotencyKey,
        })
      ).status,
    ).toBe(409);
    expect((await operator.request('GET', `/products?q=OTHER-${suffix}`)).body.total).toBe(0);
    expect((await operator.request('GET', `/products?q=${sku}`)).body.total).toBe(1);
    const exported = await operator.request('POST', '/exports', {
      kind: 'products',
      filters: { q: sku },
    });
    const ready = await poll(operator, `/exports/${exported.body.jobId}`);
    expect(ready.status).toBe('SUCCEEDED');
    expect(ready.rowCount).toBe(1);
    expect(ready).toMatchObject({
      actorId: operator.user.id,
      actorName: operator.user.displayName,
      canCommit: false,
    });
    const bossExports = await boss.request('GET', '/exports?kind=products');
    expect(bossExports.status).toBe(200);
    expect(
      bossExports.body.items.find((item: any) => item.id === exported.body.jobId),
    ).toMatchObject({
      actorId: operator.user.id,
      actorName: operator.user.displayName,
      canCommit: false,
    });
    expect((await boss.request('GET', `/exports?actorId=${colleague.user.id}`)).body.total).toBe(0);
    expect(
      (await colleague.request('GET', `/exports?actorId=${operator.user.id}`)).body.total,
    ).toBe(0);
    const download = await raw(operator, 'GET', `/exports/${exported.body.jobId}/download`);
    expect(download.status).toBe(200);
    const result = new ExcelJS.Workbook();
    await result.xlsx.load(await download.arrayBuffer());
    expect(result.getWorksheet('数据').getRow(2).getCell(2).value).toBe(
      '=HYPERLINK("https://invalid.example")',
    );
  });

  test('逐行错误、公式拒绝与错误文件', async () => {
    const bytes = await workbook('products', [
      { sku: `VALID-${suffix}`, name: '合法产品', priceExTax: '5' },
      { sku: `INVALID-${suffix}`, name: '非法金额', priceExTax: '1.234' },
    ]);
    const uploaded = await upload(operator, '/imports/preview', bytes, 'invalid.xlsx', XLSX_MIME, {
      kind: 'products',
    });
    const preview = await poll(operator, `/imports/${uploaded.body.jobId}`);
    expect(preview.previewValid).toBe(false);
    expect(preview.errors.some((error: any) => error.row === 3)).toBe(true);
    expect((await operator.request('GET', `/products?q=VALID-${suffix}`)).body.total).toBe(0);
    expect(
      (
        await operator.request('POST', `/imports/${uploaded.body.jobId}/commit`, {
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(422);
    const errors = await raw(operator, 'GET', `/imports/${uploaded.body.jobId}/errors`);
    expect(errors.status).toBe(200);
    const errorsBook = new ExcelJS.Workbook();
    await errorsBook.xlsx.load(await errors.arrayBuffer());
    expect(errorsBook.getWorksheet('数据').getRow(2).getCell(1).text).toBe('3');
    const formulas = await workbook('products', [
      { sku: `FORMULA-${suffix}`, name: { formula: '1+1', result: 2 }, priceExTax: '1' },
    ]);
    const formulaUpload = await upload(
      operator,
      '/imports/preview',
      formulas,
      'formula.xlsx',
      XLSX_MIME,
      { kind: 'products' },
    );
    const formulaPreview = await poll(operator, `/imports/${formulaUpload.body.jobId}`);
    expect(formulaPreview.previewValid).toBe(false);
    expect(formulaPreview.errors.some((error: any) => error.message.includes('公式'))).toBe(true);
  });

  test('提交重验发生冲突时整批回滚', async () => {
    const firstSku = `ATOMIC-A-${suffix}`;
    const secondSku = `ATOMIC-B-${suffix}`;
    const bytes = await workbook('products', [
      { sku: firstSku, name: '原子一', priceExTax: '2' },
      { sku: secondSku, name: '原子二', priceExTax: '3' },
    ]);
    const uploaded = await upload(operator, '/imports/preview', bytes, 'atomic.xlsx', XLSX_MIME, {
      kind: 'products',
    });
    expect((await poll(operator, `/imports/${uploaded.body.jobId}`)).previewValid).toBe(true);
    expect(
      (
        await colleague.request('POST', '/products', {
          sku: secondSku,
          name: '占用编号',
          priceExTax: '4',
        })
      ).status,
    ).toBe(201);
    await operator.request('POST', `/imports/${uploaded.body.jobId}/commit`, {
      idempotencyKey: randomUUID(),
    });
    expect((await poll(operator, `/imports/${uploaded.body.jobId}`)).status).toBe('FAILED');
    expect((await operator.request('GET', `/products?q=${firstSku}`)).body.total).toBe(0);
    expect((await operator.request('GET', `/products?q=${secondSku}`)).body.total).toBe(1);
  });

  test('历史客户与多明细已付款订单原子导入', async () => {
    const contactName = `历史客户${suffix}`;
    const customerBytes = await workbook('customers', [
      {
        companyName: '历史公司',
        contactName,
        contactPhone: '0013800000000',
        bankAccount: '000012345678',
        merchantAccountNames: merchant.name,
        sourceChannel: '微信',
        followupStatus: '已付款',
        lastDealAt: '2026-09-01T04:00:00Z',
        productSkus: product.sku,
      },
    ]);
    const customerUpload = await upload(
      operator,
      '/imports/preview',
      customerBytes,
      'customers.xlsx',
      XLSX_MIME,
      { kind: 'customers' },
    );
    expect((await poll(operator, `/imports/${customerUpload.body.jobId}`)).previewValid).toBe(true);
    expect(
      (await operator.request('GET', `/customers?q=${encodeURIComponent(contactName)}`)).body.total,
    ).toBe(0);
    await operator.request('POST', `/imports/${customerUpload.body.jobId}/commit`, {
      idempotencyKey: randomUUID(),
    });
    expect((await poll(operator, `/imports/${customerUpload.body.jobId}`)).createdCount).toBe(1);
    const importedCustomer = (
      await operator.request('GET', `/customers?q=${encodeURIComponent(contactName)}`)
    ).body.items[0];
    expect(importedCustomer.contactPhone).toBe('0013800000000');
    expect(importedCustomer.bankAccount).toBe('000012345678');
    expect(importedCustomer.status).toBe('已付款');
    expect(
      (await operator.request('GET', `/orders?customerId=${importedCustomer.id}`)).body.total,
    ).toBe(0);
    const orderBase = {
      group: 'paid',
      customerNo: importedCustomer.customerNo,
      orderDate: '2026-09-19',
      recipientName: '收货人',
      recipientPhone: '0013800000000',
      recipientAddress: '上海市',
      invoiceRequired: '是',
      type: '正常',
      freight: '1',
      packaging: '2',
      tax: '3',
      taxRate: '13',
      taxFeeMode: '自动计算',
      totalInclTaxOverride: '32.70',
      productSku: product.sku,
      status: '已付款',
      paidAt: '2026-09-19T04:00:00Z',
      receivingAccount: '工商银行 622200001234',
      paymentNote: '历史付款',
      externalSource: '导入测试',
      externalOrderNo: `HISTORY-${suffix}`,
    };
    const orderBytes = await workbook('orders', [
      { ...orderBase, quantity: '2', unitPriceExTax: '10.20' },
      { ...orderBase, quantity: '3', unitPriceExTax: '2.10' },
    ]);
    const orderUpload = await upload(
      operator,
      '/imports/preview',
      orderBytes,
      'paid.xlsx',
      XLSX_MIME,
      { kind: 'orders' },
    );
    const preview = await poll(operator, `/imports/${orderUpload.body.jobId}`);
    expect(preview.previewValid).toBe(true);
    expect(preview.expectedNew).toBe(1);
    expect(preview.rowCount).toBe(2);
    expect(
      (await operator.request('GET', `/orders?customerId=${importedCustomer.id}`)).body.total,
    ).toBe(0);
    await operator.request('POST', `/imports/${orderUpload.body.jobId}/commit`, {
      idempotencyKey: randomUUID(),
    });
    expect((await poll(operator, `/imports/${orderUpload.body.jobId}`)).createdCount).toBe(1);
    const orders = (await operator.request('GET', `/orders?customerId=${importedCustomer.id}`)).body
      .items;
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('已付款');
    expect(orders[0].totalInclTax).toBe('32.70');
    expect(orders[0]).toMatchObject({
      taxRate: '13',
      taxFeeMode: 'auto',
      taxFee: '3.47',
      calculatedTotalInclTax: '33.17',
      receivingAccount: '工商银行 622200001234',
    });
    const exported = await operator.request('POST', '/exports', {
      kind: 'orders',
      filters: { customerId: importedCustomer.id },
    });
    expect((await poll(operator, `/exports/${exported.body.jobId}`)).rowCount).toBe(2);
    const downloaded = await raw(operator, 'GET', `/exports/${exported.body.jobId}/download`);
    expect(downloaded.status).toBe(200);
    const result = new ExcelJS.Workbook();
    await result.xlsx.load(await downloaded.arrayBuffer());
    const sheet = result.getWorksheet('数据');
    const exportedValues: Record<string, unknown> = {};
    sheet.getRow(1).eachCell((cell: { value: string }, index: number) => {
      exportedValues[String(cell.value)] = sheet.getRow(2).getCell(index).value;
    });
    expect(exportedValues).toMatchObject({
      '税率（%）': '13',
      税费计算方式: '自动计算',
      调整后含税总计: '32.70',
      含税总计: '32.70',
      收款账号: '工商银行 622200001234',
    });
    expect(orders[0].lines).toHaveLength(2);
    const changed = await operator.request('GET', `/customers/${importedCustomer.id}`);
    expect(new Date(changed.body.lastDealAt).toISOString()).toBe('2026-09-19T04:00:00.000Z');
    const invalidBytes = await workbook('orders', [
      {
        ...orderBase,
        externalOrderNo: `MISSING-${suffix}`,
        paidAt: '',
        quantity: '1',
        unitPriceExTax: '1',
      },
      {
        ...orderBase,
        group: 'valid',
        externalOrderNo: `ROLLBACK-${suffix}`,
        quantity: '1',
        unitPriceExTax: '1',
      },
    ]);
    const invalidUpload = await upload(
      operator,
      '/imports/preview',
      invalidBytes,
      'missing-date.xlsx',
      XLSX_MIME,
      { kind: 'orders' },
    );
    expect((await poll(operator, `/imports/${invalidUpload.body.jobId}`)).previewValid).toBe(false);
    expect(
      (await operator.request('GET', `/orders?customerId=${importedCustomer.id}`)).body.total,
    ).toBe(1);
    const unauthorizedUpload = await upload(
      colleague,
      '/imports/preview',
      orderBytes,
      'private.xlsx',
      XLSX_MIME,
      { kind: 'orders' },
    );
    expect((await poll(colleague, `/imports/${unauthorizedUpload.body.jobId}`)).previewValid).toBe(
      false,
    );
    expect(
      (await colleague.request('GET', `/orders?customerId=${importedCustomer.id}`)).body.total,
    ).toBe(0);
  });

  test('客户转交后旧导出文件与待提交订单失效', async () => {
    const bytes = await workbook('orders', [
      {
        group: '1',
        customerNo: customer.customerNo,
        orderDate: '2026-09-20',
        recipientName: '收货人',
        recipientPhone: '0013800000000',
        recipientAddress: '上海市',
        invoiceRequired: '否',
        type: '正常',
        freight: '0',
        packaging: '0',
        tax: '0',
        productSku: product.sku,
        quantity: '1',
        unitPriceExTax: '10.20',
      },
    ]);
    const uploaded = await upload(operator, '/imports/preview', bytes, 'orders.xlsx', XLSX_MIME, {
      kind: 'orders',
    });
    expect((await poll(operator, `/imports/${uploaded.body.jobId}`)).previewValid).toBe(true);
    const exported = await operator.request('POST', '/exports', {
      kind: 'customers',
      filters: { q: customer.contactName },
    });
    expect((await poll(operator, `/exports/${exported.body.jobId}`)).rowCount).toBe(1);
    const originalFile = await raw(operator, 'GET', `/exports/${exported.body.jobId}/download`);
    expect(originalFile.status).toBe(200);
    await originalFile.arrayBuffer();
    expect((await colleague.request('GET', `/exports/${exported.body.jobId}`)).status).toBe(404);
    expect(
      (
        await boss.request('POST', `/customers/${customer.id}/assign`, {
          version: customer.version,
          ownerId: colleague.user.id,
        })
      ).status,
    ).toBe(201);
    expect((await raw(operator, 'GET', `/exports/${exported.body.jobId}/download`)).status).toBe(
      403,
    );
    const tasks = await operator.request('GET', '/exports?kind=customers');
    expect(tasks.status).toBe(200);
    expect(tasks.body.items.some((item: any) => item.id === exported.body.jobId)).toBe(false);
    await operator.request('POST', `/imports/${uploaded.body.jobId}/commit`, {
      idempotencyKey: randomUUID(),
    });
    const failed = await poll(boss, `/imports/${uploaded.body.jobId}`);
    expect(failed.status).toBe('FAILED');
    expect((await operator.request('GET', `/imports/${uploaded.body.jobId}`)).status).toBe(403);
    expect((await boss.request('GET', `/orders?customerId=${customer.id}`)).body.total).toBe(0);
  });
});
