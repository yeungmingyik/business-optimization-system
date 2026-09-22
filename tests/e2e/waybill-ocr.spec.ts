import { expect, test, type Page } from '@playwright/test';
import { ApiClient } from '../api-client';

const owner = new ApiClient();
const attachments = new Map<Page, string>();
const recognizePath = '**/api/v1/waybills/*/recognize';
const recognized = { carrier: '顺丰速运', trackingNo: 'SF1234567890123' };

async function openWaybill(page: Page) {
  await page.goto('/');
  await page.getByLabel(/^账号/).fill('test-owner');
  await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await page.goto('/orders/new');
  await page.getByRole('button', { name: '添加物流', exact: true }).click();
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/waybills') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await page
    .locator('.waybill-attachments input[type="file"]')
    .setInputFiles('tests/fixtures/waybills/baseline.jpg');
  attachments.set(page, (await (await uploaded).json()).id);
  await expect(page.getByRole('link', { name: '查看运单图片1', exact: true })).toBeVisible();
  await page.getByLabel('物流公司', { exact: true }).fill('原物流公司');
  await page.getByLabel('物流单号', { exact: true }).fill('MANUAL123456789');
}

function holdResponse(page: Page) {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let responded: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => {
    responded = resolve;
  });
  const install = page.route(recognizePath, async (route) => {
    requested();
    await pending;
    await route.fulfill({ status: 200, json: recognized }).catch(() => undefined);
    responded();
  });
  return { release, started, completed, install };
}

test.beforeAll(async () => {
  await owner.login('test-owner', 'TestOwner2026!Local');
});

test.afterEach(async ({ page }) => {
  await page.close();
  const id = attachments.get(page);
  if (id) {
    const result = await owner.request('DELETE', `/waybills/${id}`);
    expect([200, 204, 404]).toContain(result.status);
    attachments.delete(page);
  }
});

test('识别通过同源带CSRF的POST取得候选，人工修改确认后才填入物流', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await openWaybill(page);
  let recognitionRequests = 0;
  await page.route(recognizePath, async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    recognitionRequests++;
    await route.fulfill({ status: 200, json: recognized });
  });
  await page.getByRole('button', { name: '识别', exact: true }).click();
  await expect(page.getByLabel('识别物流单号', { exact: true })).toHaveValue(recognized.trackingNo);
  await expect(page.getByLabel('物流公司', { exact: true })).toHaveValue('原物流公司');
  await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL123456789');
  await page.getByLabel('识别物流公司', { exact: true }).fill('顺丰快运');
  await page.getByLabel('识别物流单号', { exact: true }).fill('SF9876543210123');
  await page.getByRole('button', { name: '使用识别结果', exact: true }).click();
  await expect(page.getByLabel('物流公司', { exact: true })).toHaveValue('顺丰快运');
  await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('SF9876543210123');
  await expect(page.locator('.waybill-recognition')).toHaveCount(0);
  expect(recognitionRequests).toBe(1);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin)).toEqual(
    [],
  );
  expect(requests.filter((url) => new URL(url).pathname.startsWith('/ocr/'))).toEqual([]);
  expect(page.workers()).toHaveLength(0);
});

test('取消识别立即恢复操作，迟到响应不填入候选或表单', async ({ page }) => {
  await openWaybill(page);
  const response = holdResponse(page);
  await response.install;
  try {
    await page.getByRole('button', { name: '识别', exact: true }).click();
    await response.started;
    const status = page.locator('.waybill-progress');
    await expect(status).toContainText('识别中');
    await expect(status).not.toContainText('%');
    await expect(status.getByRole('progressbar')).toHaveCount(0);
    await status.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '识别', exact: true })).toBeEnabled();
    response.release();
    await response.completed;
    await expect(page.locator('.waybill-recognition')).toHaveCount(0);
    await expect(page.locator('.waybill-progress')).toHaveCount(0);
    await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL123456789');
    await expect(page.locator('.waybill-attachments [role="alert"]')).toHaveCount(0);
  } finally {
    response.release();
  }
});

test('识别服务失败保留附件和输入，可以重试并放弃候选', async ({ page }) => {
  await openWaybill(page);
  let attempts = 0;
  await page.route(recognizePath, async (route) => {
    attempts++;
    await route.fulfill(
      attempts === 1
        ? { status: 503, json: { message: '识别服务暂不可用，请重试' } }
        : { status: 200, json: recognized },
    );
  });
  await page.getByRole('button', { name: '识别', exact: true }).click();
  await expect(page.locator('.waybill-attachments [role="alert"]')).toContainText(
    '识别服务暂不可用',
  );
  await expect(page.getByRole('link', { name: '查看运单图片1', exact: true })).toBeVisible();
  await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL123456789');
  await page.getByRole('button', { name: '识别', exact: true }).click();
  await expect(page.getByLabel('识别物流单号', { exact: true })).toHaveValue(recognized.trackingNo);
  await expect(page.locator('.waybill-attachments [role="alert"]')).toHaveCount(0);
  await page
    .locator('.waybill-recognition')
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page.locator('.waybill-recognition')).toHaveCount(0);
  await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL123456789');
  expect(attempts).toBe(2);
});

test('识别超过90秒停止等待并保留手工输入', async ({ page }) => {
  await openWaybill(page);
  await page.clock.install();
  const response = holdResponse(page);
  await response.install;
  try {
    await page.getByRole('button', { name: '识别', exact: true }).click();
    await response.started;
    await page.clock.runFor(90001);
    await expect(page.locator('.waybill-attachments [role="alert"]')).toContainText('识别超时');
    await expect(page.getByRole('button', { name: '识别', exact: true })).toBeEnabled();
    await expect(page.locator('.waybill-progress')).toHaveCount(0);
    await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL123456789');
    response.release();
    await response.completed;
    await expect(page.locator('.waybill-recognition')).toHaveCount(0);
  } finally {
    response.release();
  }
});

test('离开订单页后识别结果不会写入重新打开的表单', async ({ page }) => {
  await openWaybill(page);
  const response = holdResponse(page);
  await response.install;
  try {
    await page.getByRole('button', { name: '识别', exact: true }).click();
    await response.started;
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: '产品清单', exact: true }).click();
    await expect(page.getByRole('heading', { name: '产品清单', exact: true })).toBeVisible();
    response.release();
    await response.completed;
    await page.goto('/orders/new');
    await expect(page.getByRole('heading', { name: '新增订单', exact: true })).toBeVisible();
    await expect(page.locator('.waybill-recognition')).toHaveCount(0);
    await expect(page.locator('.waybill-list')).toHaveCount(0);
  } finally {
    response.release();
  }
});

test('无可用识别结果时保留原字段并允许继续手工录入', async ({ page }) => {
  await openWaybill(page);
  await page.route(recognizePath, (route) => route.fulfill({ status: 200, json: {} }));
  await page.getByRole('button', { name: '识别', exact: true }).click();
  await expect(page.locator('.waybill-attachments [role="alert"]')).toContainText(
    '未识别到物流信息',
  );
  await expect(page.locator('.waybill-recognition')).toHaveCount(0);
  await page.getByLabel('物流单号', { exact: true }).fill('MANUAL987654321');
  await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('MANUAL987654321');
  await expect(page.getByRole('button', { name: '识别', exact: true })).toBeEnabled();
});
