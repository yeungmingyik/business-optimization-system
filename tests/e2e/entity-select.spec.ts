import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ApiClient, testPassword } from '../api-client';

type ProductFixture = { id: string; name: string; sku: string };
type CustomerFixture = { id: string; contactName: string; deliveryAddress: string };

const owner = new ApiClient();
const operator = new ApiClient();
const runId = randomUUID().slice(0, 12);
const loginName = `selector-${runId}`;
const productPrefix = `SELECT-${runId}`;
const products: ProductFixture[] = [];
let customer: CustomerFixture;
let otherCustomer: CustomerFixture;

function ok(response: Awaited<ReturnType<ApiClient['request']>>) {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel(/^账号/).fill(loginName);
  await page.getByLabel(/^密码/).fill(testPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
}

async function editCustomer(page: Page) {
  await page.goto('/customers');
  await page
    .getByRole('textbox', { name: '搜索公司、联系人、联系方式', exact: true })
    .fill(customer.contactName);
  await page
    .getByRole('row')
    .filter({ hasText: customer.contactName })
    .getByRole('button', { name: '查看', exact: true })
    .click();
  await page.getByRole('button', { name: '编辑客户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑客户', exact: true });
  await expect(dialog.getByLabel(/^姓名 \/ 称呼/)).toHaveValue(customer.contactName);
  return dialog;
}

test.beforeAll(async ({}, testInfo) => {
  const baseUrl = new URL(String(testInfo.project.use.baseURL));
  if (baseUrl.hostname !== '127.0.0.1' || !['5174', '5175'].includes(baseUrl.port))
    throw new Error('ISOLATED_TEST_BROWSER_REQUIRED');
  await owner.login('test-owner', 'TestOwner2026!Local');
  const account = ok(
    await owner.request('POST', '/users', {
      loginName,
      displayName: `选择器验收-${runId}`,
      role: 'OPERATOR',
    }),
  );
  await operator.login(loginName, account.temporaryPassword);
  ok(
    await operator.request('POST', '/auth/change-password', {
      currentPassword: account.temporaryPassword,
      newPassword: testPassword,
    }),
  );
  await operator.login(loginName, testPassword);
  const merchant = ok(
    await owner.request('POST', '/merchant-accounts', {
      name: `选择器账号-${runId}`,
      platform: '微信',
    }),
  );
  for (const suffix of ['A', 'B', 'C']) {
    products.push(
      ok(
        await operator.request('POST', '/products', {
          sku: `${productPrefix}-${suffix}`,
          name: `选择器产品${suffix}-${runId}`,
          priceExTax: '10.00',
          unit: '件',
        }),
      ),
    );
  }
  const customerInput = {
    merchantAccountId: merchant.id,
    sourceChannel: '微信',
    contactPhone: '13800000000',
    deliveryAddress: '广州市选择器验收园区 18 号',
  };
  customer = ok(
    await operator.request('POST', '/customers', {
      ...customerInput,
      contactName: `选择器客户甲-${runId}`,
      productIds: [products[0].id, products[1].id],
    }),
  );
  otherCustomer = ok(
    await operator.request('POST', '/customers', {
      ...customerInput,
      contactName: `选择器客户乙-${runId}`,
      productIds: [products[2].id],
    }),
  );
});

test('必填产品引导焦点，键盘选择及重开搜索后可以保存并编辑订单', async ({ page }) => {
  await login(page);
  await page.goto(`/orders/new?customerId=${customer.id}`);
  await expect(page.getByLabel('收货地址', { exact: false })).toHaveValue(customer.deliveryAddress);
  const product = page.getByRole('button', { name: '明细产品', exact: true });
  const search = page.getByRole('textbox', { name: '搜索明细产品', exact: true });
  await page.getByRole('button', { name: '保存订单', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/new\?/);
  await expect(product).toHaveAttribute('aria-invalid', 'true');
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(product).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();
  await search.fill(products[0].sku);
  const option = page.getByRole('option').filter({ hasText: products[0].name });
  await expect(
    page.getByRole('listbox', { name: '明细产品选项', exact: true }).getByRole('option'),
  ).toHaveCount(1);
  await expect(option).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '清空搜索', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(option).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).not.toBeVisible();
  await expect(product).toHaveText(products[0].name);
  await expect(product).not.toHaveAttribute('aria-invalid', 'true');
  await expect(product).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue(products[0].sku);
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '登记付款', exact: true })).toBeVisible();
  const orderId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(ok(await operator.request('GET', `/orders/${orderId}`)).lines[0].productId).toBe(
    products[0].id,
  );
  await page.getByRole('link', { name: '编辑订单', exact: true }).click();
  await expect(product).toHaveText(products[0].name);
});

test('可选产品筛选可以清空并恢复未匹配客户', async ({ page }) => {
  await login(page);
  await page.goto('/customers');
  const selectedCustomer = page.getByRole('row').filter({ hasText: customer.contactName });
  const unselectedCustomer = page.getByRole('row').filter({ hasText: otherCustomer.contactName });
  await expect(selectedCustomer).toBeVisible();
  await expect(unselectedCustomer).toBeVisible();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const product = page.getByRole('button', { name: '意向产品', exact: true });
  await product.click();
  await page.getByRole('textbox', { name: '搜索意向产品', exact: true }).fill(products[0].sku);
  await page.getByRole('option').filter({ hasText: products[0].name }).click();
  await expect(product).toHaveText(products[0].name);
  await expect(selectedCustomer).toBeVisible();
  await expect(unselectedCustomer).toHaveCount(0);
  await page.getByRole('button', { name: '清空意向产品', exact: true }).click();
  await expect(product).toHaveText('选择意向产品');
  await expect(selectedCustomer).toBeVisible();
  await expect(unselectedCustomer).toBeVisible();
  await expect(page.getByRole('button', { name: '清空意向产品', exact: true })).toHaveCount(0);
});

test('再次点击触发按钮关闭弹层，点击外部输入框后保留外部焦点', async ({ page }) => {
  await login(page);
  await page.goto(`/orders/new?customerId=${customer.id}`);
  await expect(page.getByLabel('收货地址', { exact: false })).toHaveValue(customer.deliveryAddress);
  const product = page.getByRole('button', { name: '明细产品', exact: true });
  const search = page.getByRole('textbox', { name: '搜索明细产品', exact: true });
  const note = page.getByLabel('订单备注', { exact: true });
  const contentId = await product.getAttribute('aria-controls');
  expect(contentId).toBeTruthy();
  await expect(product).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(product).toHaveAttribute('aria-expanded', 'false');
  await product.focus();
  await page.keyboard.press('Space');
  await expect(search).toBeFocused();
  await expect(product).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog', { name: '明细产品', exact: true })).toHaveAttribute(
    'id',
    contentId!,
  );
  await search.fill(productPrefix);
  await product.click();
  await expect(search).not.toBeVisible();
  await expect(product).toHaveAttribute('aria-expanded', 'false');
  await expect(product).toBeFocused();
  await product.click();
  await expect(search).toHaveValue(productPrefix);
  await expect(search).toBeFocused();
  await expect(product).toHaveAttribute('aria-controls', contentId!);
  await note.click();
  await expect(search).not.toBeVisible();
  await expect(product).toHaveAttribute('aria-expanded', 'false');
  await expect(note).toBeFocused();
  await page.keyboard.type('外部字段编辑');
  await expect(note).toHaveValue('外部字段编辑');
  await expect(note).toBeFocused();
});

test('已有客户的多选产品补全名称，增删选择后关闭重开和刷新均保持', async ({ page }) => {
  await login(page);
  let dialog = await editCustomer(page);
  let product = dialog.getByRole('button', { name: '意向产品', exact: true });
  await expect(product).toHaveText(`${products[0].name}、${products[1].name}`);
  await product.click();
  const search = page.getByRole('textbox', { name: '搜索意向产品', exact: true });
  await search.fill(productPrefix);
  const first = page.getByRole('option').filter({ hasText: products[0].name });
  const second = page.getByRole('option').filter({ hasText: products[1].name });
  const third = page.getByRole('option').filter({ hasText: products[2].name });
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(third).toHaveAttribute('aria-selected', 'false');
  await third.click();
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await first.click();
  await expect(first).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Escape');
  await expect(product).toHaveText(`${products[1].name}、${products[2].name}`);
  await product.click();
  await expect(search).toHaveValue(productPrefix);
  await expect(first).toHaveAttribute('aria-selected', 'false');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(ok(await operator.request('GET', `/customers/${customer.id}`)).productIds).toEqual([
    products[1].id,
    products[2].id,
  ]);
  await page.reload();
  dialog = await editCustomer(page);
  product = dialog.getByRole('button', { name: '意向产品', exact: true });
  await expect(product).toHaveText(`${products[1].name}、${products[2].name}`);
  await product.click();
  await search.fill(productPrefix);
  await expect(first).toHaveAttribute('aria-selected', 'false');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(third).toHaveAttribute('aria-selected', 'true');
});
