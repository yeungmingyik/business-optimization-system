import { expect, test } from '@playwright/test';
import { ApiClient } from '../api-client';

const cases = [
  {
    name: '合成顺丰运单',
    path: 'tests/fixtures/waybills/baseline.jpg',
    carrier: '顺丰速运',
    trackingNo: 'SF1234567890123',
  },
];

if (process.env.BOS_OCR_ACCEPTANCE_IMAGE) {
  if (!process.env.BOS_OCR_ACCEPTANCE_CARRIER || !process.env.BOS_OCR_ACCEPTANCE_NUMBER)
    throw new Error('OCR_ACCEPTANCE_EXPECTATIONS_REQUIRED');
  cases.push({
    name: '本地实拍运单',
    path: process.env.BOS_OCR_ACCEPTANCE_IMAGE,
    carrier: process.env.BOS_OCR_ACCEPTANCE_CARRIER,
    trackingNo: process.env.BOS_OCR_ACCEPTANCE_NUMBER,
  });
}

for (const sample of cases) {
  test(`${sample.name}经真实识别服务确认并保存订单`, async ({ page }) => {
    test.setTimeout(120000);
    const owner = new ApiClient();
    await owner.login('test-owner', 'TestOwner2026!Local');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const merchant = await owner.request('POST', '/merchant-accounts', {
      name: `识别验收-${suffix}`,
      platform: '微信',
    });
    expect(merchant.status).toBeLessThan(300);
    const customer = await owner.request('POST', '/customers', {
      contactName: `识别客户-${suffix}`,
      contactPhone: '13800138000',
      deliveryAddress: '广州市海珠区测试地址 10 号',
      merchantAccountId: merchant.body.id,
      sourceChannel: '微信',
    });
    expect(customer.status).toBeLessThan(300);
    const product = await owner.request('POST', '/products', {
      sku: `OCR-${suffix}`,
      name: `识别验收商品-${suffix}`,
      priceExTax: '10.00',
    });
    expect(product.status).toBeLessThan(300);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');
    await page.getByLabel(/^账号/).fill('test-owner');
    await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await page.goto(`/orders/new?customerId=${customer.body.id}`);
    await page.getByRole('button', { name: '明细产品', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索明细产品', exact: true }).fill(product.body.sku);
    await page.getByRole('option').filter({ hasText: product.body.sku }).click();
    await page.getByRole('button', { name: '添加物流', exact: true }).click();
    await page.locator('.waybill-attachments input[type="file"]').setInputFiles(sample.path);
    await expect(page.getByRole('link', { name: '查看运单图片1', exact: true })).toBeVisible();
    const response = page.waitForResponse((value) => value.url().endsWith('/recognize'));
    await page.getByRole('button', { name: '识别', exact: true }).click();
    await page.getByLabel('订单备注', { exact: true }).fill('识别期间填写备注');
    expect((await response).status()).toBe(200);
    await expect(page.getByLabel('识别物流单号', { exact: true })).toHaveValue(sample.trackingNo, {
      timeout: 90000,
    });
    await expect(page.getByLabel('识别物流公司', { exact: true })).toHaveValue(sample.carrier);
    await expect(page.getByLabel('物流单号', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '使用识别结果', exact: true }).click();
    await page.getByRole('button', { name: '保存订单', exact: true }).click();
    await expect(page.getByRole('button', { name: '登记付款', exact: true })).toBeVisible();
    const saved = await owner.request('GET', `/orders/${page.url().split('/').at(-1)}`);
    expect(saved.body.shipments[0]).toMatchObject({
      carrier: sample.carrier,
      trackingNo: sample.trackingNo,
    });
    expect(saved.body.shipments[0].attachmentIds).toHaveLength(1);
    expect(saved.body.note).toBe('识别期间填写备注');
    const origin = new URL(page.url()).origin;
    expect(requests.filter((url) => new URL(url).pathname.startsWith('/ocr/'))).toEqual([]);
    expect(
      requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin),
    ).toEqual([]);
  });
}
