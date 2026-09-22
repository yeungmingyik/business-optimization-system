import { test, expect } from '@playwright/test';
import { ApiClient } from '../api-client';

const owner = new ApiClient();
const runId = Date.now().toString(36);
let customer: any;
let product: any;

test.beforeAll(async () => {
  await owner.login('test-owner', 'TestOwner2026!Local');
  const merchant = (
    await owner.request('POST', '/merchant-accounts', {
      name: `优化商家-${runId}`,
      platform: '微信',
    })
  ).body;
  customer = (
    await owner.request('POST', '/customers', {
      contactName: `收货联系人-${runId}`,
      contactPhone: '13800138000',
      deliveryAddress: '广州市海珠区收货园区 20 号',
      companyAddress: '深圳市公司注册地址 1 号',
      merchantAccountId: merchant.id,
      sourceChannel: '微信',
    })
  ).body;
  product = (
    await owner.request('POST', '/products', {
      sku: `OPT-${runId}`,
      name: `金额优化产品-${runId}`,
      unit: '件',
      priceExTax: '100.00',
    })
  ).body;
});

test('收货地址、自动税费、金额调整与收款账号形成完整操作链', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel(/^账号/).fill('test-owner');
  await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  await page.goto(`/orders/new?customerId=${customer.id}`);
  await expect(page.getByLabel('收货地址', { exact: false })).toHaveValue(customer.deliveryAddress);
  await page.getByRole('button', { name: '明细产品', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索明细产品', exact: true }).fill(product.sku);
  await page.getByRole('option').filter({ hasText: product.name }).click();
  await page.getByLabel('数量', { exact: true }).fill('2');
  await page.getByLabel('运费（元）', { exact: false }).fill('10.00');
  await page.getByLabel('包装费（元）', { exact: false }).fill('2.00');
  await page.getByLabel('税率（%）', { exact: false }).fill('13');
  const tax = page.getByLabel('税费（元）', { exact: false });
  const total = page.getByLabel('含税总计（元）', { exact: true });
  await expect(tax).toHaveValue('26.00');
  await expect(total).toHaveValue('238.00');
  await page.getByLabel('数量', { exact: true }).fill('3');
  await expect(tax).toHaveValue('39.00');
  await expect(total).toHaveValue('351.00');
  await tax.fill('8.00');
  await expect(total).toHaveValue('320.00');
  await page.getByLabel('数量', { exact: true }).fill('4');
  await expect(tax).toHaveValue('8.00');
  await expect(total).toHaveValue('420.00');
  await tax.fill('');
  await page.getByRole('button', { name: '恢复税费自动计算', exact: true }).click();
  await expect(tax).toHaveValue('52.00');
  await expect(total).toHaveValue('464.00');
  await total.fill('450.00');
  await page.getByLabel('运费（元）', { exact: false }).fill('20.00');
  await expect(total).toHaveValue('450.00');
  await page.getByRole('button', { name: '恢复含税总计自动计算', exact: true }).click();
  await expect(total).toHaveValue('474.00');
  await total.fill('460.00');
  await page.getByRole('button', { name: '保存订单', exact: true }).click();
  await expect(page.getByRole('button', { name: '登记付款', exact: true })).toBeVisible();
  const orderId = page.url().split('/').at(-1)!;
  const saved = (await owner.request('GET', `/orders/${orderId}`)).body;
  expect(saved).toMatchObject({
    taxRate: '13',
    taxFee: '52.00',
    taxFeeMode: 'auto',
    totalInclTax: '460.00',
    calculatedTotalInclTax: '474.00',
    recipientAddress: customer.deliveryAddress,
  });
  await page.getByRole('button', { name: '登记付款', exact: true }).click();
  const payment = page.getByRole('dialog');
  await payment.getByLabel('收款账号', { exact: false }).fill('001234 工商银行');
  await payment.getByRole('button', { name: '确认', exact: true }).click();
  await expect(payment).not.toBeVisible();
  await expect(page.getByText('收款账号 001234 工商银行').first()).toBeVisible();
  await page.getByRole('button', { name: '更正付款', exact: true }).click();
  const correction = page.getByRole('dialog');
  await expect(correction.getByLabel('收款账号', { exact: false })).toHaveValue('001234 工商银行');
  await correction.getByLabel('收款账号', { exact: false }).fill('009876 招商银行');
  await correction.getByLabel('更正原因', { exact: false }).fill('原收款账号登记有误');
  await correction.getByRole('button', { name: '确认', exact: true }).click();
  await expect(correction).not.toBeVisible();
  await expect(page.getByText('收款账号 009876 招商银行').first()).toBeVisible();
  const changes = (await owner.request('GET', `/orders/${orderId}/payments`)).body;
  expect(changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ receivingAccount: '001234 工商银行' }),
      expect.objectContaining({ receivingAccount: '009876 招商银行' }),
    ]),
  );
  await page.getByRole('link', { name: '编辑订单', exact: true }).click();
  await expect(page.getByLabel('税率（%）', { exact: false })).toBeDisabled();
  await expect(page.getByLabel('税费（元）', { exact: false })).toBeDisabled();
  await expect(page.getByLabel('含税总计（元）', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '.artifacts/tests/order-refinements.png', fullPage: true });
});

for (const format of ['png', 'jpeg', 'webp'] as const) {
  test(`${format.toUpperCase()} 运单上传、识别候选核对后随订单保存`, async ({ page }) => {
    test.setTimeout(120000);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    let recognitionRequests = 0;
    await page.route('**/api/v1/waybills/*/recognize', async (route) => {
      expect(route.request().method()).toBe('POST');
      recognitionRequests++;
      await route.fulfill({
        status: 200,
        json: { carrier: '顺丰速运', trackingNo: 'SF1234567890123' },
      });
    });
    await page.goto('/');
    await page.getByLabel(/^账号/).fill('test-owner');
    await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await page.goto(`/orders/new?customerId=${customer.id}`);
    await expect(page.getByLabel('收货地址', { exact: false })).toHaveValue(
      customer.deliveryAddress,
    );
    await page.getByRole('button', { name: '明细产品', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索明细产品', exact: true }).fill(product.sku);
    await page.getByRole('option').filter({ hasText: product.name }).click();
    expect(requests.filter((url) => new URL(url).pathname.startsWith('/ocr/'))).toEqual([]);
    await page.getByRole('button', { name: '添加物流', exact: true }).click();
    const image = await page.evaluate(async (format) => {
      await document.fonts.load('600 52px "Noto Sans SC"', '顺丰速运');
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 380;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 1200, 380);
      context.fillStyle = '#111';
      context.font = '600 52px "Noto Sans SC"';
      context.fillText('顺丰速运', 50, 90);
      context.font = '48px Arial';
      context.fillText('SF EXPRESS', 400, 90);
      context.fillText('TRACKING NO: SF1234567890123', 50, 205);
      return canvas.toDataURL(`image/${format}`, 0.95).split(',')[1];
    }, format);
    await page.locator('.waybill-attachments input[type="file"]').setInputFiles({
      name: format === 'jpeg' ? '手机运单.JPG' : `waybill.${format}`,
      mimeType: `image/${format}`,
      buffer:
        format === 'jpeg'
          ? Buffer.concat([Buffer.from(image, 'base64'), Buffer.from('\r\n\0\0')])
          : Buffer.from(image, 'base64'),
    });
    await expect(page.getByRole('link', { name: '查看运单图片1', exact: true })).toBeVisible();
    await expect(page.locator('.waybill-attachments img').first()).toHaveJSProperty(
      'naturalWidth',
      1200,
    );
    await page.getByRole('button', { name: '识别', exact: true }).click();
    const recognizedNumber = page.getByLabel('识别物流单号', { exact: true });
    await expect(recognizedNumber).toHaveValue('SF1234567890123');
    await expect(page.getByLabel('识别物流公司', { exact: true })).toHaveValue('顺丰速运');
    await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '使用识别结果', exact: true }).click();
    await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('SF1234567890123');
    await page.getByRole('button', { name: '保存订单', exact: true }).click();
    await expect(page.getByRole('button', { name: '登记付款', exact: true })).toBeVisible();
    const saved = (await owner.request('GET', `/orders/${page.url().split('/').at(-1)}`)).body;
    expect(saved.shipments).toHaveLength(1);
    expect(saved.shipments[0]).toMatchObject({
      carrier: '顺丰速运',
      trackingNo: 'SF1234567890123',
    });
    expect(saved.shipments[0].attachmentIds).toHaveLength(1);
    await expect(page.getByRole('link', { name: '查看运单图片1', exact: true })).toBeVisible();
    const origin = new URL(page.url()).origin;
    expect(recognitionRequests).toBe(1);
    expect(requests.filter((url) => new URL(url).pathname.startsWith('/ocr/'))).toEqual([]);
    expect(
      requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin),
    ).toEqual([]);
    await page.screenshot({ path: `.artifacts/tests/order-waybill-${format}.png`, fullPage: true });
  });
}
