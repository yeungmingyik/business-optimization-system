import { test, expect, type Locator, type Page } from '@playwright/test';

async function fontSize(locator: Locator) {
  return locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel(/^账号/).fill('test-owner');
  await page.getByLabel(/^密码/).fill('TestOwner2026!Local');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
}

async function expectTextFits(locator: Locator) {
  const measurements = await locator.evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const contentHeight =
        rect.height -
        parseFloat(style.borderTopWidth) -
        parseFloat(style.borderBottomWidth) -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const lineHeight =
        style.lineHeight === 'normal'
          ? parseFloat(style.fontSize) * 1.2
          : parseFloat(style.lineHeight);
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRects = Array.from(range.getClientRects());
      return {
        label: element.getAttribute('aria-label') || element.textContent || element.tagName,
        heightFits: contentHeight + 1 >= lineHeight,
        textFits: textRects.every(
          (textRect) =>
            textRect.left >= rect.left - 1 &&
            textRect.right <= rect.right + 1 &&
            textRect.top >= rect.top - 1 &&
            textRect.bottom <= rect.bottom + 1,
        ),
      };
    }),
  );
  expect(measurements.length).toBeGreaterThan(0);
  expect(measurements.filter((item) => !item.heightFits || !item.textFits)).toEqual([]);
}

for (const width of [1440, 390]) {
  test(`${width}px 屏幕在浏览器字号放大到 200% 后仍可操作客户表单`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const session = await page.context().newCDPSession(page);
    await session.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
    await login(page);
    await page.goto('/customers');
    const heading = page.getByRole('heading', { name: '客户管理', exact: true });
    const addCustomer = page.getByRole('button', { name: '新增客户', exact: true });
    await expect(heading).toBeVisible();
    const samples = [
      page.locator('html'),
      page.locator('body'),
      heading,
      page.getByRole('textbox', { name: '搜索公司、联系人、联系方式' }),
      addCustomer,
    ];
    const defaultSizes = await Promise.all(samples.map(fontSize));
    await session.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await page.reload();
    await expect(heading).toBeVisible();
    const enlargedSizes = await Promise.all(samples.map(fontSize));
    for (const [index, value] of enlargedSizes.entries()) {
      expect(value / defaultSizes[index]).toBeCloseTo(2, 1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    if (width === 1440) {
      const brand = page.locator('.sidebar .brand');
      const brandText = brand.locator('span');
      await expect(brandText).toBeVisible();
      await expectTextFits(brandText);
      const brandBox = await brand.boundingBox();
      const brandTextBox = await brandText.boundingBox();
      expect(brandTextBox!.x).toBeGreaterThanOrEqual(brandBox!.x);
      expect(brandTextBox!.x + brandTextBox!.width).toBeLessThanOrEqual(
        brandBox!.x + brandBox!.width + 1,
      );
    }
    await addCustomer.click();
    const dialog = page.getByRole('dialog', { name: '新增客户', exact: true });
    await expect(dialog).toBeVisible();
    const contactName = dialog.getByLabel(/^姓名 \/ 称呼/);
    await contactName.fill('林经理');
    await expect(contactName).toHaveValue('林经理');
    await expectTextFits(
      dialog.locator('input:not([type="checkbox"]):not([type="hidden"]), select'),
    );
    await expectTextFits(dialog.locator('.field-label'));
    const save = dialog.getByRole('button', { name: '保存', exact: true });
    await expectTextFits(save);
    await save.click({ trial: true });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width + 1);
    expect(await fontSize(page.locator('html'))).toBe(enlargedSizes[0]);
    await page.screenshot({ path: `.artifacts/tests/typography-${width}-200.png` });
    expect(await fontSize(page.locator('html'))).toBe(enlargedSizes[0]);
    page.once('dialog', (confirmation) => confirmation.accept());
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(addCustomer).toBeFocused();
  });
}

test('320px 工作台在正常和 200% 字号下保持日期筛选可用', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const session = await page.context().newCDPSession(page);
  await session.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });
  await login(page);
  for (const size of [16, 32]) {
    await session.send('Page.setFontSizes', {
      fontSizes: { standard: size, fixed: Math.round(size * 0.8125) },
    });
    const summaryResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/dashboard/summary' && response.ok(),
    );
    await page.reload();
    await summaryResponse;
    await expect(page.locator('.metric-value')).toHaveCount(4);
    await expect(page.locator('.metric-value').first()).toContainText(/\d/);
    expect(await fontSize(page.locator('html'))).toBe(size);
    for (const [label, parameter, offset] of [
      ['开始日期', 'startDate', -1],
      ['结束日期', 'endDate', 1],
    ] as const) {
      const input = page.getByLabel(label, { exact: true });
      await input.scrollIntoViewIfNeeded();
      const box = await input.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(321);
      await expectTextFits(input);
      await input.focus();
      await expect(input).toBeFocused();
      const date = new Date(`${await input.inputValue()}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const value = date.toISOString().slice(0, 10);
      const changedSummary = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === '/api/v1/dashboard/summary' &&
          url.searchParams.get(parameter) === value &&
          response.ok()
        );
      });
      await input.fill(value);
      await expect(input).toHaveValue(value);
      await changedSummary;
      await expect(page.locator('.metric-value')).toHaveCount(4);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.artifacts/tests/typography-dashboard-320-${size}.png` });
    expect(await fontSize(page.locator('html'))).toBe(size);
  }
});
