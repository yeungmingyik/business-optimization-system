import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApiClient } from '../tests/api-client';

async function main() {
  const baseUrl = 'http://127.0.0.1:5175';
  const directory = resolve(process.env.BOS_PERFORMANCE_OUTPUT ?? '.artifacts/performance');
  const owner = new ApiClient();
  await owner.login('test-owner', 'TestOwner2026!Local');
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const samples: any[] = [];

  try {
    for (let round = 1; round <= 3; round++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies([
        {
          name: 'bos_session',
          value: owner.cookie.split('=')[1],
          domain: '127.0.0.1',
          path: '/api',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await context.newPage();
      await page.addInitScript(() => {
        const measurements = { lcp: 0, cls: 0, longTasks: [] as number[] };
        (window as any).__measurements = measurements;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) measurements.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as any[])
            if (!entry.hadRecentInput) measurements.cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((list) => {
          measurements.longTasks.push(...list.getEntries().map((entry) => entry.duration));
        }).observe({ type: 'longtask', buffered: true });
      });
      const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 80,
        downloadThroughput: 1250000,
        uploadThroughput: 1250000,
        connectionType: 'cellular4g',
      });
      await page.goto(`${baseUrl}/dashboard`);
      await page.locator('.metric-card').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const result = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return {
          ...(window as any).__measurements,
          jsBytes: resources
            .filter((item) => /\.js$/.test(new URL(item.name).pathname))
            .reduce((total, item) => total + item.encodedBodySize, 0),
          cssBytes: resources
            .filter((item) => /\.css$/.test(new URL(item.name).pathname))
            .reduce((total, item) => total + item.encodedBodySize, 0),
          fontBytes: resources
            .filter((item) => /\.woff2$/.test(new URL(item.name).pathname))
            .reduce((total, item) => total + item.encodedBodySize, 0),
          fontFiles: resources.filter((item) => /\.woff2$/.test(item.name)).length,
          fontResources: resources
            .filter((item) => /\.woff2$/.test(new URL(item.name).pathname))
            .map((item) => ({ path: new URL(item.name).pathname, bytes: item.encodedBodySize })),
          fontFamily: getComputedStyle(document.body).fontFamily,
        };
      });
      const interactionSamples: number[] = [];
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      for (const label of ['客户管理', '订单管理', '产品清单', '资料库', '工作台']) {
        const startedAt = performance.now();
        await page.getByRole('link', { name: label, exact: true }).click();
        await page.getByRole('heading', { name: label, exact: true }).first().waitFor();
        interactionSamples.push(Math.round(performance.now() - startedAt));
      }
      samples.push({ round, ...result, navigationMilliseconds: interactionSamples });
      process.stdout.write(`${JSON.stringify(samples.at(-1))}\n`);
      await page.screenshot({
        path: resolve(directory, `dashboard-round-${round}.png`),
        fullPage: true,
      });
      await context.close();
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const report = {
      measuredAt: new Date().toISOString(),
      viewport: '1440x1000',
      network: { downloadMbps: 10, latencyMilliseconds: 80 },
      samples,
      medianLcpMilliseconds: median(samples.map((sample) => sample.lcp)),
      maximumCls: Math.max(...samples.map((sample) => sample.cls)),
      maximumFontBytes: Math.max(...samples.map((sample) => sample.fontBytes)),
      targets: { medianLcpMilliseconds: 2500, cls: 0.1, initialFontBytes: 358400 },
      unmeasured: ['inp', 'cpu_throttling', '100_row_scroll'],
    };
    await writeFile(
      resolve(directory, 'browser-performance.json'),
      JSON.stringify(report, null, 2),
    );
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
