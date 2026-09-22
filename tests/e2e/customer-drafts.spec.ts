import { expect, test, type Page } from '@playwright/test';
import { ApiClient } from '../api-client';

const owner = new ApiClient();
const runId = Date.now().toString(36);
let merchant: { id: string };
let product: { id: string; sku: string; name: string };

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel(/^账号/).fill('test-owner');
  await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '客户管理', exact: true }).click();
}

async function openDraft(page: Page) {
  await page.getByRole('button', { name: '新增客户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('收货地址', { exact: true })).toBeVisible();
  return dialog;
}

test.beforeAll(async () => {
  await owner.login('test-owner', 'TestOwner2026!Local');
  merchant = (
    await owner.request('POST', '/merchant-accounts', {
      name: `草稿账号-${runId}`,
      platform: '微信',
    })
  ).body;
  product = (
    await owner.request('POST', '/products', {
      sku: `DRAFT-${runId}`,
      name: `草稿检测仪-${runId}`,
      unit: '台',
      priceExTax: '200.00',
    })
  ).body;
});

test.beforeEach(async () => {
  const current = (await owner.request('GET', '/customer-drafts/current')).body;
  const result = await owner.request('DELETE', '/customer-drafts/current', {
    version: current.version,
  });
  expect(result.status).toBeLessThan(300);
});

test.afterEach(async ({ page }) => {
  await page.close();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await owner.request('GET', '/customer-drafts/current')).body;
    const result = await owner.request('DELETE', '/customer-drafts/current', {
      version: current.version,
    });
    if (result.status !== 409) {
      expect(result.status).toBeLessThan(300);
      return;
    }
  }
  throw new Error('CUSTOMER_DRAFT_CLEANUP_CONFLICT');
});

test('不完整客户草稿关闭与刷新后恢复，保存后收货地址用于新订单', async ({ page }) => {
  await login(page);
  let dialog = await openDraft(page);
  const deliveryAddress = `广东省广州市交付园区-${runId}`;
  const companyAddress = `广东省深圳市登记园区-${runId}`;
  await dialog.getByLabel('联系电话', { exact: true }).fill('13800138000');
  await dialog.getByLabel('收货地址', { exact: true }).fill(deliveryAddress);
  await dialog.getByLabel('公司地址', { exact: true }).fill(companyAddress);
  await dialog.getByLabel(/所属账号/).selectOption(merchant.id);
  await dialog.getByLabel(/负责人/).selectOption(owner.user.id);
  await dialog.getByLabel('下次跟进', { exact: true }).fill('2030-10-01T09:30');
  await dialog.getByRole('button', { name: '意向产品', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索意向产品', exact: true }).fill(product.sku);
  await page.getByRole('option').filter({ hasText: product.name }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
  dialog = await openDraft(page);
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue(deliveryAddress);
  await expect(dialog.getByLabel('公司地址', { exact: true })).toHaveValue(companyAddress);
  await expect(dialog.getByLabel(/所属账号/)).toHaveValue(merchant.id);
  await expect(dialog.getByLabel(/负责人/)).toHaveValue(owner.user.id);
  await expect(dialog.getByLabel('下次跟进', { exact: true })).toHaveValue('2030-10-01T09:30');
  await expect(dialog.getByRole('button', { name: '意向产品', exact: true })).toHaveText(
    product.name,
  );
  await page.reload();
  dialog = await openDraft(page);
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue(deliveryAddress);
  await expect(dialog.getByLabel(/姓名 \/ 称呼/)).toHaveValue('');
  await dialog.getByLabel(/姓名 \/ 称呼/).fill(`草稿联系人-${runId}`);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect
    .poll(async () => (await owner.request('GET', '/customer-drafts/current')).body.document)
    .toBeNull();
  await page
    .getByRole('textbox', { name: '搜索公司、联系人、联系方式' })
    .fill(`草稿联系人-${runId}`);
  const row = page.getByRole('row').filter({ hasText: `草稿联系人-${runId}` });
  await row.getByRole('button', { name: '查看', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByText(deliveryAddress, { exact: true })).toBeVisible();
  await expect(detail.getByText(companyAddress, { exact: true })).toBeVisible();
  await detail.getByRole('link', { name: '创建订单', exact: true }).click();
  await expect(page.getByLabel(/^收货地址/)).toHaveValue(deliveryAddress);
  await page.goto('/customers');
  dialog = await openDraft(page);
  await expect(dialog.getByLabel(/姓名 \/ 称呼/)).toHaveValue('');
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue('');
});

test('草稿无需必填字段即可保存，清空后不再恢复', async ({ page }) => {
  await login(page);
  let dialog = await openDraft(page);
  await dialog.getByLabel('收货地址', { exact: true }).fill('上海市草稿收货地址');
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog.getByText('草稿已保存', { exact: true })).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: '清空草稿', exact: true }).click();
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
  dialog = await openDraft(page);
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue('');
  expect((await owner.request('GET', '/customer-drafts/current')).body.document).toBeNull();
});

test('草稿载入失败不会开放空白编辑或覆盖服务器草稿', async ({ page }) => {
  const current = (await owner.request('GET', '/customer-drafts/current')).body;
  await owner.request('PUT', '/customer-drafts/current', {
    version: current.version,
    document: { deliveryAddress: '保留服务器收货地址' },
  });
  await login(page);
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/customer-drafts/current') && request.method() === 'PUT')
      saves.push(request.url());
  });
  await page.route('**/customer-drafts/current', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"草稿暂不可用"}',
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: '新增客户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.unroute('**/customer-drafts/current');
  await openDraft(page);
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue('保留服务器收货地址');
  expect(saves).toEqual([]);
});

test('并发更新冲突保留当前输入，确认后才能覆盖远端草稿', async ({ page }) => {
  await login(page);
  const dialog = await openDraft(page);
  await dialog.getByLabel('收货地址', { exact: true }).fill('当前窗口收货地址');
  await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(dialog.getByText('草稿已保存', { exact: true })).toBeVisible();
  const current = (await owner.request('GET', '/customer-drafts/current')).body;
  const remote = await owner.request('PUT', '/customer-drafts/current', {
    version: current.version,
    document: { ...current.document, deliveryAddress: '另一窗口收货地址' },
  });
  expect(remote.status).toBeLessThan(300);
  await dialog.getByLabel('联系电话', { exact: true }).fill('13900139000');
  await expect(dialog.getByText('草稿保存失败', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('收货地址', { exact: true })).toHaveValue('当前窗口收货地址');
  expect(
    (await owner.request('GET', '/customer-drafts/current')).body.document.deliveryAddress,
  ).toBe('另一窗口收货地址');
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: '保存当前输入', exact: true }).click();
  await expect(dialog.getByText('草稿已保存', { exact: true })).toBeVisible();
  const saved = (await owner.request('GET', '/customer-drafts/current')).body.document;
  expect(saved.deliveryAddress).toBe('当前窗口收货地址');
  expect(saved.contactPhone).toBe('13900139000');
});
