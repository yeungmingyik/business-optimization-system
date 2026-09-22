import { chromium, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism, cpus, freemem, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { ApiClient } from '../tests/api-client';

const root = resolve(process.env.BOS_ROOT ?? process.cwd());
const rate = Number(process.env.BOS_INTERACTION_CPU_RATE ?? '1');
const rounds = Number(process.env.BOS_INTERACTION_ROUNDS ?? '50');
const orderLines = Number(process.env.BOS_INTERACTION_ORDER_LINES ?? '100');
const scrollDurationMs = Number(process.env.BOS_INTERACTION_SCROLL_MS ?? '20000');
const baseUrl = 'http://127.0.0.1:5175';
const run = `interaction-${randomUUID()}`;
const smoke = rounds < 50 || scrollDurationMs < 20000;
const profileEnabled = process.env.BOS_INTERACTION_PROFILE === '1';
const outputPrefix = `interactions-${orderLines === 100 ? '' : `${orderLines}-lines-`}`;
const output = resolve(
  root,
  '.artifacts/acceptance',
  `${outputPrefix}${profileEnabled ? 'profile-' : smoke ? 'smoke-' : ''}${rate}.json`,
);
const ids = {
  user: randomUUID(),
  merchant: randomUUID(),
  order: randomUUID(),
  customers: Array.from({ length: 100 }, () => randomUUID()),
  products: Array.from({ length: 100 }, () => randomUUID()),
};
const password = `Interaction${randomUUID()}2026!`;
const phases: { name: string; round: number; durationMs: number; success: boolean }[] = [];
const errors: string[] = [];
const apiFailures: { path: string; status: number }[] = [];
let seeded = false;
let pool: any;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    maximum: sorted.at(-1) ?? null,
  };
}

async function seed() {
  const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
  const { Pool } = apiRequire('pg');
  const argon2 = apiRequire('argon2');
  if (!process.env.BOS_TEST_DB_PASSWORD) throw new Error('TEST_DATABASE_PASSWORD_REQUIRED');
  pool = new Pool({
    host: '127.0.0.1',
    port: 54322,
    database: 'business_test',
    user: 'business_test',
    password: process.env.BOS_TEST_DB_PASSWORD,
    options: '-c search_path=public',
    ssl: false,
    max: 2,
  });
  if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== 'business_test')
    throw new Error('TEST_DATABASE_REQUIRED');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      "INSERT INTO users(id,login_name,display_name,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,'OPERATOR',false)",
      [ids.user, run, '交互性能运营', await argon2.hash(password)],
    );
    await tx.query("INSERT INTO merchant_accounts(id,name,platform) VALUES($1,$2,'微信')", [
      ids.merchant,
      run,
    ]);
    for (let index = 0; index < 100; index++) {
      const suffix = String(index + 1).padStart(4, '0');
      await tx.query(
        'INSERT INTO customers(id,owner_id,merchant_account_id,document) VALUES($1,$2,$3,$4)',
        [
          ids.customers[index],
          ids.user,
          ids.merchant,
          JSON.stringify({
            contactName: `Bench${suffix}`,
            companyName: `交互验收企业${suffix}`,
            contactPhone: `1380000${suffix}`,
            companyAddress: '广州市测试办公地址',
            deliveryAddress: '广州市测试收货地址',
            merchantAccountId: ids.merchant,
            sourceChannel: '微信',
            status: '待跟进',
            lastDealAt: null,
            nextFollowupAt: null,
            productIds: [],
            tagIds: [],
          }),
        ],
      );
      await tx.query('INSERT INTO products(id,sku,document) VALUES($1,$2,$3)', [
        ids.products[index],
        `${run}-${suffix}`,
        JSON.stringify({
          name: `交互验收产品${suffix}`,
          model: `M${suffix}`,
          unit: '件',
          priceExTax: '10.00',
          categoryId: null,
          tagIds: [],
          assetIds: [],
        }),
      ]);
    }
    const initialTotal = `${orderLines * 10}.00`;
    const document = {
      customerId: ids.customers[0],
      orderDate: '2026-09-20',
      type: '正常',
      recipientName: 'Bench0001',
      recipientPhone: '13800000001',
      recipientAddress: '广州市测试收货地址',
      invoiceRequired: false,
      note: '',
      originalOrderId: null,
      externalSource: '',
      externalOrderNo: '',
      freightFee: '0.00',
      packagingFee: '0.00',
      taxRate: '0',
      taxFeeMode: 'auto',
      taxFee: '0.00',
      calculatedTaxFee: '0.00',
      calculatedTotalInclTax: initialTotal,
      totalInclTaxOverride: null,
      goodsTotal: initialTotal,
      totalExTax: initialTotal,
      totalInclTax: initialTotal,
      paymentNote: '',
      receivingAccount: '',
      shipments: [],
      lines: ids.products.slice(0, orderLines).map((productId, index) => ({
        productId,
        sku: `${run}-${String(index + 1).padStart(4, '0')}`,
        name: `交互验收产品${String(index + 1).padStart(4, '0')}`,
        model: `M${String(index + 1).padStart(4, '0')}`,
        unit: '件',
        quantity: 1,
        unitPriceExTax: '10.00',
        lineTotal: '10.00',
      })),
    };
    await tx.query(
      "INSERT INTO orders(id,customer_id,status,type,order_date,total_incl_tax,document) VALUES($1,$2,'待付款','正常',$3,$4,$5)",
      [
        ids.order,
        ids.customers[0],
        document.orderDate,
        document.totalInclTax,
        JSON.stringify(document),
      ],
    );
    await tx.query('COMMIT');
    seeded = true;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

async function cleanup() {
  if (!seeded) return;
  if ((await pool.query('SELECT current_database() AS name')).rows[0].name !== 'business_test')
    throw new Error('TEST_DATABASE_REQUIRED');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const owner = await tx.query('SELECT login_name FROM users WHERE id=$1 FOR UPDATE', [ids.user]);
    if (owner.rows[0]?.login_name !== run) throw new Error('CLEANUP_SCOPE_INVALID');
    await tx.query('DELETE FROM audit_events WHERE actor_id=$1', [ids.user]);
    await tx.query('DELETE FROM sessions WHERE user_id=$1', [ids.user]);
    await tx.query('DELETE FROM login_attempts WHERE login_name=$1', [run]);
    await tx.query('DELETE FROM customer_drafts WHERE user_id=$1', [ids.user]);
    await tx.query('DELETE FROM orders WHERE id=$1 AND customer_id=$2', [
      ids.order,
      ids.customers[0],
    ]);
    await tx.query('DELETE FROM customers WHERE id=ANY($1::uuid[]) AND owner_id=$2', [
      ids.customers,
      ids.user,
    ]);
    await tx.query('DELETE FROM products WHERE id=ANY($1::uuid[]) AND sku LIKE $2', [
      ids.products,
      `${run}-%`,
    ]);
    await tx.query('DELETE FROM merchant_accounts WHERE id=$1 AND name=$2', [ids.merchant, run]);
    await tx.query('DELETE FROM users WHERE id=$1 AND login_name=$2', [ids.user, run]);
    await tx.query('COMMIT');
    seeded = false;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

async function afterPaint() {
  await page!.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function measure(name: string, round: number, action: () => Promise<void>) {
  await page!.evaluate(
    ({ name, round }) => {
      const benchmark = (window as any).__interactionBenchmark;
      benchmark.current = { name, round, start: performance.now(), end: null };
      benchmark.phases.push(benchmark.current);
    },
    { name, round },
  );
  const started = performance.now();
  let success = false;
  try {
    await action();
    await afterPaint();
    success = true;
  } finally {
    phases.push({ name, round, durationMs: performance.now() - started, success });
    await page!.evaluate(() => {
      (window as any).__interactionBenchmark.current.end = performance.now();
    });
  }
}

async function main() {
  if (!/^D:[\\/]/i.test(root) || !/^D:[\\/]/i.test(chromium.executablePath()))
    throw new Error('D_DRIVE_REQUIRED');
  if (!Number.isFinite(rate) || rate < 1 || rate > 16) throw new Error('INVALID_CPU_RATE');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 50) throw new Error('INVALID_ROUNDS');
  if (!Number.isInteger(orderLines) || orderLines < 1 || orderLines > 100)
    throw new Error('INVALID_ORDER_LINES');
  if (!Number.isFinite(scrollDurationMs) || scrollDurationMs < 1000 || scrollDurationMs > 20000)
    throw new Error('INVALID_SCROLL_DURATION');
  await mkdir(resolve(root, '.artifacts/acceptance'), { recursive: true });
  const report: Record<string, any> = {
    run,
    startedAt: new Date().toISOString(),
    status: 'not_run',
    smoke,
    profileEnabled,
    automationProbe: 'css_quantity_selectors_assertions_after_two_animation_frames',
    scope: 'business_test_laboratory_interactions_not_real_user_INP',
    baseUrl,
    apiUrl: 'http://127.0.0.1:3001/api/v1',
    fixture: {
      seed: 20260922,
      operators: 1,
      customers: 100,
      products: 100,
      orders: 1,
      orderLines,
    },
    viewport: { width: 1440, height: 900 },
    hardware: {
      platform: process.platform,
      osRelease: release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      availableParallelism: availableParallelism(),
      memoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      storage: process.env.BOS_PERF_STORAGE ?? 'D_drive_disk_model_not_recorded',
    },
    cpuThrottlingRate: rate,
    network: { downloadMbps: 10, uploadMbps: 10, latencyMs: 80, transport: 'loopback' },
    build: {
      mode: 'production_preview',
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      indexSha256: createHash('sha256')
        .update(await readFile(resolve(root, 'apps/web/dist/index.html')))
        .digest('hex'),
    },
    limitations: [
      'synthetic_laboratory_event_timing_not_real_user_INP',
      'event_timing_under_16ms_is_not_reported_and_durations_are_rounded_by_browser',
      'actual_hardware_is_not_fixed_ENV_PERF_4_core_8GB_60Hz',
      'cpu_throttling_changes_browser_execution_only_not_server_cpu_or_memory',
      'single_operator_100_customers_not_DS_SCALE_or_20_concurrent_sessions',
      'warm_navigation_after_initial_customer_page_load_first_order_form_visit_included',
      'end_to_end_action_durations_include_playwright_network_debounce_and_render_waits',
      'quantity_assertions_use_CSS_after_two_animation_frames_to_reduce_pre_paint_automation_overhead',
      ...(orderLines === 100 ? [] : ['reduced_order_lines_do_not_satisfy_100_line_TC_NFR_007']),
    ],
  };
  try {
    await seed();
    const operator = new ApiClient();
    await operator.login(run, password);
    const accessible = await operator.request('GET', '/customers?pageSize=100');
    if (accessible.status !== 200 || accessible.body.total !== 100)
      throw new Error('ISOLATED_CUSTOMER_SCOPE_MISMATCH');
    const order = await operator.request('GET', `/orders/${ids.order}`);
    if (order.status !== 200 || order.body.lines.length !== orderLines)
      throw new Error('ORDER_FIXTURE_MISMATCH');
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
    await context.addCookies([
      {
        name: 'bos_session',
        value: operator.cookie.split('=')[1],
        domain: '127.0.0.1',
        path: '/api',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/') && response.status() >= 400)
        apiFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    const initializeMeasurements = () => {
      const benchmark = {
        phases: [] as any[],
        events: [] as any[],
        longTasks: [] as any[],
        frames: [] as number[],
        current: null as any,
        scrolling: false,
        previousFrame: 0,
        observers: [] as PerformanceObserver[],
        supported: PerformanceObserver.supportedEntryTypes,
      };
      (window as any).__interactionBenchmark = benchmark;
      const collectEvents = (entries: PerformanceEntry[]) => {
        for (const entry of entries as any[]) {
          if (entry.interactionId)
            benchmark.events.push({
              name: entry.name,
              start: entry.startTime,
              duration: entry.duration,
              interactionId: entry.interactionId,
              inputDelay: entry.processingStart - entry.startTime,
              processingDuration: entry.processingEnd - entry.processingStart,
            });
        }
      };
      if (benchmark.supported.includes('event')) {
        const observer = new PerformanceObserver((list) => collectEvents(list.getEntries()));
        observer.observe({
          type: 'event',
          buffered: true,
          durationThreshold: 16,
        } as PerformanceObserverInit);
        benchmark.observers.push(observer);
      }
      if (benchmark.supported.includes('longtask')) {
        const observer = new PerformanceObserver((list) => {
          benchmark.longTasks.push(
            ...list
              .getEntries()
              .map((entry) => ({ start: entry.startTime, duration: entry.duration })),
          );
        });
        observer.observe({ type: 'longtask', buffered: true });
        benchmark.observers.push(observer);
      }
      const frame = (time: number) => {
        if (benchmark.scrolling && benchmark.previousFrame)
          benchmark.frames.push(time - benchmark.previousFrame);
        benchmark.previousFrame = benchmark.scrolling ? time : 0;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    await page.addInitScript({
      content: `const __name = (value) => value; (${initializeMeasurements.toString()})();`,
    });
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate });
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 80,
      downloadThroughput: 1250000,
      uploadThroughput: 1250000,
      connectionType: 'cellular4g',
    });
    await session.send('Performance.enable');
    await page.goto(`${baseUrl}/customers`);
    await expect(page.getByRole('heading', { name: '客户管理', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看', exact: true })).toHaveCount(50);
    await page.evaluate(() => document.fonts.ready);
    if ((await page.evaluate(() => (window as any).__interactionBenchmark.observers.length)) !== 2)
      throw new Error('PERFORMANCE_OBSERVERS_UNAVAILABLE');
    const heapSamples: number[] = [];
    for (let round = 1; round <= rounds; round++) {
      const customerName = `Bench${String(round).padStart(4, '0')}`;
      await measure('customers.navigate', round, async () => {
        await page!
          .getByRole('navigation', { name: '主导航' })
          .getByRole('link', { name: '客户管理', exact: true })
          .click();
        await afterPaint();
        await expect(page!.getByRole('heading', { name: '客户管理', exact: true })).toBeVisible();
      });
      await measure('customers.filter', round, async () => {
        const search = page!.getByRole('textbox', { name: '搜索公司、联系人、联系方式' });
        await search.click();
        await search.press('ControlOrMeta+A');
        await search.pressSequentially(customerName, { delay: 5 });
        await afterPaint();
        await expect(page!.getByRole('button', { name: '查看', exact: true })).toHaveCount(1);
        await expect(page!.getByRole('row').filter({ hasText: customerName })).toHaveCount(1);
      });
      await measure('customers.open', round, async () => {
        await page!.getByRole('button', { name: '查看', exact: true }).click();
        await afterPaint();
        await expect(page!.getByRole('dialog')).toBeVisible();
        await expect(
          page!.getByRole('dialog').getByText(customerName, { exact: true }).first(),
        ).toBeVisible();
      });
      await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
      await measure('orders.navigate', round, async () => {
        await page!
          .getByRole('navigation', { name: '主导航' })
          .getByRole('link', { name: '订单管理', exact: true })
          .click();
        await page!.getByRole('link', { name: order.body.orderNo, exact: true }).click();
        await afterPaint();
        await expect(page!.getByRole('link', { name: '编辑订单', exact: true })).toBeVisible();
      });
      const profileThisRound = profileEnabled && round === 1;
      if (profileThisRound) {
        await session.send('Profiler.enable');
        await session.send('Profiler.setSamplingInterval', { interval: 1000 });
        await session.send('Tracing.start', {
          categories: 'devtools.timeline,v8.execute,blink.user_timing',
          transferMode: 'ReturnAsStream',
          streamFormat: 'json',
        });
        await session.send('Profiler.start');
      }
      try {
        await measure('orders.open', round, async () => {
          await page!.getByRole('link', { name: '编辑订单', exact: true }).click();
          await afterPaint();
          await expect(page!.locator('.order-lines input[aria-label="数量"]')).toHaveCount(
            orderLines,
          );
        });
      } finally {
        if (profileThisRound) {
          const { profile } = await session.send('Profiler.stop');
          const traceReady = new Promise<string>((done) =>
            session.once('Tracing.tracingComplete', (event) => done(event.stream!)),
          );
          await session.send('Tracing.end');
          const stream = await traceReady;
          let trace = '';
          for (;;) {
            const chunk = await session.send('IO.read', { handle: stream });
            trace += chunk.base64Encoded
              ? Buffer.from(chunk.data, 'base64').toString()
              : chunk.data;
            if (chunk.eof) break;
          }
          await session.send('IO.close', { handle: stream });
          const profilePath = resolve(
            root,
            '.artifacts/acceptance',
            `${outputPrefix}profile-${rate}.cpuprofile`,
          );
          const tracePath = resolve(
            root,
            '.artifacts/acceptance',
            `${outputPrefix}profile-${rate}.trace.json`,
          );
          await writeFile(profilePath, JSON.stringify(profile));
          await writeFile(tracePath, trace);
          report.profile = {
            phase: 'orders.open',
            round,
            sampleIntervalMicroseconds: 1000,
            profilePath,
            tracePath,
          };
        }
      }
      await measure('orders.quantity', round, async () => {
        const quantity = page!.locator('.order-lines input[aria-label="数量"]').first();
        await quantity.click();
        await quantity.press('ControlOrMeta+A');
        await quantity.pressSequentially(String(round + 1));
        await afterPaint();
        await expect(quantity).toHaveValue(String(round + 1));
      });
      await measure('orders.save', round, async () => {
        const response = page!.waitForResponse(
          (value) =>
            value.request().method() === 'PATCH' &&
            new URL(value.url()).pathname === `/api/v1/orders/${ids.order}`,
        );
        await page!.getByRole('button', { name: '保存订单', exact: true }).click();
        const saved = await response;
        if (saved.status() !== 200) throw new Error(`ORDER_SAVE_FAILED:${saved.status()}`);
        const body = await saved.json();
        if (
          body.lines.length !== orderLines ||
          body.lines[0].quantity !== round + 1 ||
          body.totalInclTax !== `${(orderLines + round) * 10}.00`
        )
          throw new Error('SAVED_ORDER_DATA_MISMATCH');
        await afterPaint();
        await expect(page!.getByRole('link', { name: '编辑订单', exact: true })).toBeVisible();
      });
      const metrics = await session.send('Performance.getMetrics');
      heapSamples.push(
        metrics.metrics.find((value) => value.name === 'JSHeapUsedSize')?.value ?? 0,
      );
      if (round % 10 === 0)
        process.stdout.write(`${JSON.stringify({ rate, completedRounds: round })}\n`);
    }
    await page.getByRole('link', { name: '编辑订单', exact: true }).click();
    await afterPaint();
    await expect(page.locator('.order-lines input[aria-label="数量"]')).toHaveCount(orderLines);
    await page.locator('.order-lines input[aria-label="数量"]').first().scrollIntoViewIfNeeded();
    let inputCount = 0;
    let wheelCount = 0;
    let direction = 1;
    const scrollStarted = performance.now();
    await measure('orders.scroll-and-input', 0, async () => {
      await page!.evaluate(() => {
        (window as any).__interactionBenchmark.scrolling = true;
      });
      while (performance.now() - scrollStarted < scrollDurationMs) {
        const position = await page!.evaluate(() => {
          const rows = document.querySelectorAll('.order-lines tbody tr');
          return {
            first: rows[0].getBoundingClientRect().top,
            last: rows[rows.length - 1].getBoundingClientRect().bottom,
            height: innerHeight,
          };
        });
        if (position.last < position.height - 120) direction = -1;
        if (position.first > 120) direction = 1;
        await page!.mouse.move(900, 450);
        await page!.mouse.wheel(0, direction * 350);
        wheelCount++;
        await page!.waitForTimeout(30);
        const visibleIndex = await page!.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>('.order-lines input[aria-label="数量"]'),
          ).findIndex((input) => {
            const rect = input.getBoundingClientRect();
            return rect.top > 130 && rect.bottom < innerHeight - 130;
          }),
        );
        if (visibleIndex >= 0) {
          const input = page!.locator('.order-lines input[aria-label="数量"]').nth(visibleIndex);
          await input.click();
          await input.press('ControlOrMeta+A');
          await input.pressSequentially(String((inputCount % 2) + 2));
          inputCount++;
        }
      }
      await page!.evaluate(() => {
        (window as any).__interactionBenchmark.scrolling = false;
      });
    });
    await page.waitForTimeout(100);
    const measurements = await page.evaluate(() => {
      const benchmark = (window as any).__interactionBenchmark;
      return {
        phases: benchmark.phases,
        events: benchmark.events,
        longTasks: benchmark.longTasks,
        frames: benchmark.frames,
        supported: benchmark.supported,
      };
    });
    const interactionMap = new Map<number, any>();
    for (const event of measurements.events) {
      const phase = measurements.phases.find(
        (value: any) => event.start >= value.start && event.start <= value.end,
      );
      if (!phase) continue;
      const previous = interactionMap.get(event.interactionId);
      if (!previous || previous.duration < event.duration)
        interactionMap.set(event.interactionId, {
          ...event,
          phase: phase.name,
          round: phase.round,
        });
    }
    const interactions = [...interactionMap.values()];
    const longTasks = measurements.longTasks.flatMap((task: any) => {
      const phase = measurements.phases.find(
        (value: any) => task.start < value.end && task.start + task.duration >= value.start,
      );
      return phase ? [{ ...task, phase: phase.name, round: phase.round }] : [];
    });
    const corePhases = [
      'customers.filter',
      'customers.open',
      'orders.open',
      'orders.quantity',
      'orders.save',
    ];
    const coreInteractions = interactions.filter((value) => corePhases.includes(value.phase));
    const eventSummary = summary(coreInteractions.map((value) => value.duration));
    const frameSummary = summary(measurements.frames);
    const scrollTasks = longTasks.filter((task: any) => task.phase === 'orders.scroll-and-input');
    report.status = 'measured';
    report.completedRounds = phases.filter(
      (phase) => phase.name === 'orders.save' && phase.success,
    ).length;
    report.eventTiming = {
      measure: 'maximum_event_duration_per_interactionId',
      minimumReportedDurationMs: 16,
      core: eventSummary,
      interactions,
      perPhase: Object.fromEntries(
        corePhases.map((name) => [
          name,
          summary(
            interactions.filter((value) => value.phase === name).map((value) => value.duration),
          ),
        ]),
      ),
    };
    report.actions = {
      samples: phases,
      perPhase: Object.fromEntries(
        [...new Set(phases.map((phase) => phase.name))].map((name) => [
          name,
          summary(phases.filter((phase) => phase.name === name).map((phase) => phase.durationMs)),
        ]),
      ),
    };
    report.scroll = {
      durationMs: phases.at(-1)?.durationMs,
      inputCount,
      wheelCount,
      frameIntervalsMs: measurements.frames,
      summary: frameSummary,
      longTasks: scrollTasks,
    };
    report.longTasks = {
      samples: longTasks,
      summary: summary(longTasks.map((task: any) => task.duration)),
      over100ms: longTasks.filter((task: any) => task.duration > 100).length,
    };
    report.jsHeapUsedBytes = { samples: heapSamples, maximum: Math.max(...heapSamples) };
    report.performanceObserverSupportedTypes = measurements.supported;
    report.criteria = {
      completed50Rounds: report.completedRounds === 50,
      coreEventTimingP95Under200ms:
        eventSummary.p95 === null ? 'not_measured' : eventSummary.p95 <= 200,
      scrollFrameP95Under20ms: frameSummary.p95 === null ? 'not_measured' : frameSummary.p95 <= 20,
      scrollNoLongTaskOver100ms: measurements.supported.includes('longtask')
        ? scrollTasks.every((task: any) => task.duration <= 100)
        : 'not_measured',
      measuredPhasesNoLongTaskOver100ms: measurements.supported.includes('longtask')
        ? longTasks.every((task: any) => task.duration <= 100)
        : 'not_measured',
      noBrowserOrApiErrors: errors.length === 0 && apiFailures.length === 0,
      formalEnvPerfConformance: 'not_established_actual_hardware_differs',
    };
  } catch (error) {
    report.status = 'failed';
    report.failure = String(error).replaceAll(password, '[redacted]');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    try {
      await cleanup();
      report.cleanup = 'complete';
    } catch (error) {
      report.cleanup = 'failed';
      report.cleanupError = String(error).replaceAll(password, '[redacted]');
      process.exitCode = 1;
    } finally {
      if (pool) await pool.end();
    }
    report.completedAt = new Date().toISOString();
    report.browserErrors = errors;
    report.apiFailures = apiFailures;
    if (!report.actions) report.actions = { samples: phases };
    await writeFile(output, JSON.stringify(report, null, 2));
    process.stdout.write(
      `${JSON.stringify({ output, status: report.status, completedRounds: report.completedRounds, criteria: report.criteria, cleanup: report.cleanup })}\n`,
    );
  }
}

void main().catch((error) => {
  process.stderr.write(`${String(error).replaceAll(password, '[redacted]')}\n`);
  process.exitCode = 1;
});
