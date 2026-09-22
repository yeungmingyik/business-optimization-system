import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ApiClient } from '../api-client';

const owner = new ApiClient();
const runId = Date.now().toString(36);
const companyName = `瀚川设备-${runId}`;
let merchant: any;
let product: any;

async function login(page: Page, loginName = 'test-owner', password = 'TestOwner2026!Local') {
  await page.goto('/');
  await page.getByLabel(/^账号/).fill(loginName);
  await page.getByLabel(/^密码/).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  await owner.login('test-owner', 'TestOwner2026!Local');
  merchant = (
    await owner.request('POST', '/merchant-accounts', { name: `直营-${runId}`, platform: '淘宝' })
  ).body;
  product = (
    await owner.request('POST', '/products', {
      sku: `BROWSER-${runId}`,
      name: `工业检测仪-${runId}`,
      unit: '台',
      priceExTax: '1280.50',
      model: 'A200',
    })
  ).body;
});

test('客户、跟进、订单和付款形成完整操作链', async ({ page }) => {
  test.setTimeout(90000);
  await login(page);
  await page.getByRole('link', { name: '客户管理', exact: true }).click();
  await page.getByRole('button', { name: '新增客户', exact: true }).click();
  const customerForm = page.getByRole('dialog');
  await customerForm.getByLabel(/姓名 \/ 称呼/).fill(`林经理-${runId}`);
  await customerForm.getByLabel('联系电话', { exact: true }).fill('13800138000');
  await customerForm.getByLabel('企业名称', { exact: true }).fill(companyName);
  await customerForm.getByLabel(/所属账号/).selectOption(merchant.id);
  await customerForm.getByLabel(/负责人/).selectOption(owner.user.id);
  await customerForm.getByRole('button', { name: '保存', exact: true }).click();
  await expect(customerForm).not.toBeVisible();
  await page.getByRole('textbox', { name: '搜索公司、联系人、联系方式' }).fill(companyName);
  const row = page.getByRole('row').filter({ hasText: companyName });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '查看', exact: true }).click();
  const details = page.getByRole('dialog');
  await details.getByRole('button', { name: '跟进记录', exact: true }).click();
  await details.getByLabel(/^跟进内容/).fill('已确认检测范围，等待采购订单');
  await details.getByRole('button', { name: '记录跟进', exact: true }).click();
  await expect(details.getByText('已确认检测范围，等待采购订单', { exact: true })).toBeVisible();
  await details.getByRole('link', { name: '创建订单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新增订单', exact: true })).toBeVisible();
  await page.getByLabel(/^收货人/).fill('林经理');
  await page.getByLabel(/^联系方式/).fill('13800138000');
  await page.getByLabel(/^收货地址/).fill('广东省广州市测试园区 8 号');
  await page.getByRole('button', { name: '明细产品', exact: true }).last().click();
  await page.getByRole('textbox', { name: '搜索明细产品', exact: true }).fill(product.sku);
  await page.getByRole('option').filter({ hasText: product.name }).click();
  await page.getByLabel('数量', { exact: true }).fill('2');
  await page.getByRole('button', { name: '保存订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '登记付款', exact: true })).toBeVisible();
  await expect(page.getByText('2,561.00', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: '登记付款', exact: true }).click();
  const payment = page.getByRole('dialog');
  await payment.getByLabel('收款账号', { exact: false }).fill('工商银行 622200001234');
  await payment.getByLabel('付款备注', { exact: true }).fill('银行转账');
  await payment.getByRole('button', { name: '确认', exact: true }).click();
  await expect(payment).not.toBeVisible();
  await expect(page.getByText('已付款', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '.artifacts/tests/order-paid.png', fullPage: true });
  const customer = (await owner.request('GET', `/customers?q=${encodeURIComponent(companyName)}`))
    .body.items[0];
  expect(customer.status).toBe('已付款');
  expect(customer.lastDealAt).toBeTruthy();
});

test('所有业务页面可导航且中文使用自托管字体、英文与数字使用本机字体', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fontRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  await login(page);
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');
  for (const name of [
    '客户管理',
    '订单管理',
    '产品清单',
    '资料库',
    '导入记录',
    '账号管理',
    '操作记录',
    '工作台',
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'h1',
    });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    const renderedFonts = fonts.filter((font) => font.glyphCount > 0);
    expect(renderedFonts.length, name).toBeGreaterThan(0);
    expect(
      renderedFonts.every((font) => font.isCustomFont && font.familyName === 'Noto Sans SC'),
      name,
    ).toBe(true);
  }
  await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.dataset.testid = 'latin-font-probe';
    probe.textContent = 'YIJINTOOL ABCabc 0123456789';
    document.body.append(probe);
  });
  await page.evaluate(() => document.fonts.ready);
  const { root } = await session.send('DOM.getDocument');
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-testid="latin-font-probe"]',
  });
  const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
  const latinFonts = fonts.filter((font) => font.glyphCount > 0);
  expect(latinFonts.length).toBeGreaterThan(0);
  expect(latinFonts.every((font) => !font.isCustomFont)).toBe(true);
  await page.getByTestId('latin-font-probe').evaluate((element) => element.remove());
  expect(fontRequests.length).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const request of fontRequests) {
    const url = new URL(request);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toMatch(/^\/fonts\/noto-sans-sc\/[^/]+\.woff2$/);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: '.artifacts/tests/dashboard-desktop.png', fullPage: true });
});

test('编辑抽屉保留未保存输入并支持键盘操作', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: '产品清单', exact: true }).click();
  await page.getByRole('button', { name: '新增产品', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^产品名称/).fill('未保存的产品');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^产品名称/)).toHaveValue('未保存的产品');
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '新增产品', exact: true })).toBeFocused();
});

test('窄屏导航与减少动态效果可用', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByRole('button', { name: '切换导航', exact: true }).click();
  await page.getByRole('link', { name: '客户管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '客户管理', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增客户', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(769);
  const duration = await dialog.evaluate((element) => getComputedStyle(element).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.01);
  await page.screenshot({ path: '.artifacts/tests/customer-tablet.png', fullPage: true });
});

test('主要页面满足自动可访问性检查', async ({ page }) => {
  await login(page);
  for (const route of ['/dashboard', '/customers', '/orders', '/products', '/materials']) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
});

test('运营首次改密后只显示业务权限与本人工作台', async ({ page }) => {
  const loginName = `browser-operator-${Date.now().toString(36)}`;
  const account = await owner.request('POST', '/users', {
    loginName,
    displayName: '运营人员',
    role: 'OPERATOR',
  });
  expect(account.status).toBe(201);
  await page.goto('/');
  await page.getByLabel(/^账号/).fill(loginName);
  await page.getByLabel(/^密码/).fill(account.body.temporaryPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const passwordDialog = page.getByRole('dialog', { name: '修改密码' });
  await expect(passwordDialog).toBeVisible();
  await passwordDialog.getByLabel(/^当前密码/).fill(account.body.temporaryPassword);
  await passwordDialog.getByLabel(/^新密码/).fill('BrowserOperator2026!');
  await passwordDialog.getByLabel(/^确认新密码/).fill('BrowserOperator2026!');
  await passwordDialog.getByRole('button', { name: '保存密码', exact: true }).click();
  await expect(passwordDialog).not.toBeVisible();
  await login(page, loginName, 'BrowserOperator2026!');
  await expect(page.getByText('我的客户', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '账号管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '操作记录', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('负责人', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '客户管理', exact: true }).click();
  await expect(page.getByText('暂无记录', { exact: true })).toBeVisible();
});
