import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, freemem, totalmem, platform, release, availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ApiClient } from '../tests/api-client';

const root = process.env.BOS_ROOT ?? process.cwd();
const require = createRequire(resolve(root, 'apps/api/package.json'));
const { Pool } = require('pg');
const argon2 = require('argon2');
const pool = new Pool({ max: 4 });
const logConnectionError = (error: Error) => process.stderr.write(`${error.message}\n`);
pool.on('error', logConnectionError);
pool.on('connect', (client: any) => client.on('error', logConnectionError));
const run = `perf-${randomUUID()}`;
const entityId = (kind: string, value: number) => {
  const hex = createHash('md5').update(`${run}-${kind}-${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const ownerIds = Array.from({ length: 20 }, (_, i) => entityId('user', i + 1));
const merchantId = entityId('merchant', 1);
const password = `Perf${randomUUID()}2026`;
const outputDirectory = resolve(root, '.artifacts/performance');
const samples: any[] = [];
let seeded = false;

async function seed() {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await tx.query(
      "INSERT INTO users(id,login_name,display_name,password_hash,role,must_change_password) SELECT md5($1||'-user-'||g)::uuid,$1||'-'||g,'性能运营'||g,$2,'OPERATOR',false FROM generate_series(1,20) g",
      [run, passwordHash],
    );
    await tx.query("INSERT INTO merchant_accounts(id,name,platform) VALUES($1,$2,'企业微信')", [
      merchantId,
      run,
    ]);
    await tx.query(
      "INSERT INTO products(id,sku,document) SELECT md5($1||'-product-'||g)::uuid,$1||'-P-'||g,jsonb_build_object('sku',$1||'-P-'||g,'name','性能产品'||g,'model','M'||(g%100),'unit','件','priceExTax','125.50','categoryId',null,'tagIds','[]'::jsonb,'assetIds','[]'::jsonb) FROM generate_series(1,10000) g",
      [run],
    );
    await tx.query(
      "INSERT INTO customers(id,owner_id,merchant_account_id,document) SELECT md5($1||'-customer-'||g)::uuid,md5($1||'-user-'||((g-1)%20+1))::uuid,$2,jsonb_build_object('contactName','性能客户'||g,'companyName','性能公司'||(g%1000),'contactPhone','138'||lpad(g::text,8,'0'),'companyPhone','','companyAddress','测试省测试市测试区','taxId','','bankName','','bankAccount','','taobaoId','','wechatId','','wechatName','','douyinId','','merchantAccountId',$2::uuid,'sourceChannel','企业微信','status',CASE WHEN (g/20)%4=0 THEN '已付款' WHEN (g/20)%4=1 THEN '待跟进' WHEN (g/20)%4=2 THEN '已报价' ELSE '待付款' END,'productIds',jsonb_build_array(md5($1||'-product-'||((g-1)%10000+1))::uuid),'tagIds','[]'::jsonb,'nextFollowupAt',now()+((g%30-10)::text||' days')::interval,'lastDealAt',CASE WHEN (g/20)%4=0 THEN now()-((g%50)::text||' days')::interval ELSE null END) FROM generate_series(1,100000) g",
      [run, merchantId],
    );
    await tx.query(
      "INSERT INTO orders(id,customer_id,status,type,order_date,paid_at,total_incl_tax,document) SELECT md5($1||'-order-'||g)::uuid,md5($1||'-customer-'||((g-1)%100000+1))::uuid,CASE WHEN (g/20)%5<3 THEN '已付款' WHEN (g/20)%5=3 THEN '待付款' ELSE '取消付款' END,CASE WHEN g%25=0 THEN '退货' WHEN g%25=1 THEN '维修' ELSE '正常' END,current_date-(g%120),CASE WHEN (g/20)%5<3 THEN now()-((g%90)::text||' days')::interval ELSE null END,125.50,jsonb_build_object('customerId',md5($1||'-customer-'||((g-1)%100000+1))::uuid,'recipientName','性能收货人'||g,'recipientPhone','13800000000','recipientAddress','测试省测试市测试区','invoiceRequired',g%3=0,'note','','type',CASE WHEN g%25=0 THEN '退货' WHEN g%25=1 THEN '维修' ELSE '正常' END,'orderDate',(current_date-(g%120))::text,'originalOrderId',null,'externalSource','','externalOrderNo','','freightFee','0.00','packagingFee','0.00','taxFee','0.00','goodsTotal','125.50','totalExTax','125.50','totalInclTax','125.50','paymentNote','','lines',jsonb_build_array(jsonb_build_object('productId',md5($1||'-product-'||((g-1)%10000+1))::uuid,'sku',$1||'-P-'||((g-1)%10000+1),'name','性能产品'||((g-1)%10000+1),'model','M1','unit','件','quantity',1,'unitPriceExTax','125.50','lineTotal','125.50')),'shipments','[]'::jsonb) FROM generate_series(1,200000) g",
      [run],
    );
    await tx.query(
      "INSERT INTO assets(id,document,current_version_id,created_by) SELECT md5($1||'-asset-'||g)::uuid,jsonb_build_object('name','性能资料'||g,'description','','categoryId',null,'tagIds','[]'::jsonb,'productIds',jsonb_build_array(md5($1||'-product-'||g)::uuid)),md5($1||'-asset-version-'||g)::uuid,$2 FROM generate_series(1,10000) g",
      [run, ownerIds[0]],
    );
    await tx.query(
      "INSERT INTO asset_versions(id,asset_id,storage_key,original_name,media_type,bytes,checksum,created_by) SELECT md5($1||'-asset-version-'||g)::uuid,md5($1||'-asset-'||g)::uuid,$1||'/metadata-'||g,'性能资料'||g||'.pdf','application/pdf',1024,repeat('0',64),$2 FROM generate_series(1,10000) g",
      [run, ownerIds[0]],
    );
    await tx.query('COMMIT');
    seeded = true;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
  for (const table of ['users', 'customers', 'products', 'orders', 'assets', 'asset_versions'])
    await pool.query(`VACUUM (ANALYZE) ${table}`);
}

async function cleanup() {
  if (!seeded) return;
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const verified = await tx.query(
      'SELECT count(*)::int AS count FROM users WHERE id=ANY($1::uuid[]) AND login_name LIKE $2',
      [ownerIds, `${run}-%`],
    );
    if (verified.rows[0].count !== 20 || process.env.PGDATABASE !== 'business_test')
      throw new Error('PERFORMANCE_CLEANUP_SCOPE_INVALID');
    await tx.query('DELETE FROM audit_events WHERE actor_id=ANY($1::uuid[])', [ownerIds]);
    await tx.query(
      'DELETE FROM payment_changes WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE owner_id=ANY($1::uuid[])))',
      [ownerIds],
    );
    await tx.query(
      'DELETE FROM followups WHERE customer_id IN (SELECT id FROM customers WHERE owner_id=ANY($1::uuid[]))',
      [ownerIds],
    );
    await tx.query(
      'DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE owner_id=ANY($1::uuid[]))',
      [ownerIds],
    );
    await tx.query('DELETE FROM customers WHERE owner_id=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM asset_versions WHERE created_by=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM assets WHERE created_by=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM products WHERE sku LIKE $1', [`${run}-P-%`]);
    await tx.query('DELETE FROM transfer_jobs WHERE actor_id=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ownerIds]);
    await tx.query('DELETE FROM merchant_accounts WHERE id=$1', [merchantId]);
    await tx.query('COMMIT');
    const remaining = await pool.query(
      'SELECT (SELECT count(*)::int FROM users WHERE id=ANY($1::uuid[])) AS users,(SELECT count(*)::int FROM products WHERE sku LIKE $2) AS products,(SELECT count(*)::int FROM merchant_accounts WHERE id=$3) AS merchants',
      [ownerIds, `${run}-P-%`, merchantId],
    );
    await writeFile(
      resolve(outputDirectory, `${run}-cleanup.json`),
      JSON.stringify(
        { run, cleanedAt: new Date().toISOString(), remaining: remaining.rows[0] },
        null,
        2,
      ),
    );
    if (Object.values(remaining.rows[0]).some((value) => value !== 0))
      throw new Error('PERFORMANCE_CLEANUP_INCOMPLETE');
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

async function measure(
  name: string,
  clients: ApiClient[],
  operation: (client: ApiClient, index: number, round: number) => Promise<any>,
  threshold: number,
) {
  const elapsed: number[] = [];
  const failures: any[] = [];
  await Promise.all(
    clients.map(async (client, index) => {
      for (let round = 0; round < 6; round++) {
        const started = performance.now();
        const response = await operation(client, index, round);
        const duration = performance.now() - started;
        if (round > 0) elapsed.push(duration);
        if (response.status >= 400)
          failures.push({ index, round, status: response.status, body: response.body });
      }
    }),
  );
  elapsed.sort((a, b) => a - b);
  const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1];
  const result = {
    name,
    concurrency: clients.length,
    samples: elapsed.length,
    warmupPerClient: 1,
    p50Ms: Number(elapsed[Math.floor(elapsed.length / 2)].toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    maxMs: Number(elapsed.at(-1)!.toFixed(2)),
    thresholdMs: threshold,
    passed: p95 <= threshold && failures.length === 0,
    failures,
  };
  samples.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  if (
    process.env.PGDATABASE !== 'business_test' ||
    !['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '') ||
    process.env.PGPORT !== '54322' ||
    !/^[Dd]:[\\/]/.test(root)
  )
    throw new Error('PERFORMANCE_TEST_ENV_REQUIRED');
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  try {
    await seed();
    const clients = Array.from({ length: 20 }, () => new ApiClient());
    for (let index = 0; index < clients.length; index++)
      await clients[index].login(`${run}-${index + 1}`, password);
    await measure(
      'customers.list',
      clients,
      (client) => client.request('GET', '/customers?pageSize=50'),
      500,
    );
    await measure(
      'customers.search',
      clients,
      (client) => client.request('GET', '/customers?pageSize=50&q=性能公司'),
      500,
    );
    await measure(
      'customers.followups',
      clients,
      (client) => client.request('GET', '/customers?pageSize=50&followup=today'),
      500,
    );
    await measure(
      'orders.list',
      clients,
      (client) => client.request('GET', '/orders?pageSize=50'),
      500,
    );
    await measure(
      'orders.search',
      clients,
      (client) => client.request('GET', '/orders?pageSize=50&q=性能收货人'),
      500,
    );
    await measure(
      'products.list',
      clients,
      (client) => client.request('GET', '/products?pageSize=50'),
      500,
    );
    await measure(
      'assets.list',
      clients,
      (client) => client.request('GET', '/assets?pageSize=50'),
      500,
    );
    await measure(
      'dashboard.summary',
      clients,
      (client) => client.request('GET', '/dashboard/summary'),
      500,
    );
    const customerVersions = Array.from({ length: 20 }, () => 1);
    await measure(
      'customers.save',
      clients,
      async (client, index, round) => {
        const response = await client.request(
          'PATCH',
          `/customers/${entityId('customer', index + 1)}`,
          {
            version: customerVersions[index],
            contactPhone: `139${String(index).padStart(4, '0')}${String(round).padStart(4, '0')}`,
          },
        );
        if (response.status < 400) customerVersions[index] = response.body.version;
        return response;
      },
      800,
    );
    const counts = await pool.query(
      'SELECT (SELECT count(*)::int FROM customers WHERE owner_id=ANY($1::uuid[])) AS customers,(SELECT count(*)::int FROM orders WHERE customer_id IN(SELECT id FROM customers WHERE owner_id=ANY($1::uuid[]))) AS orders,(SELECT count(*)::int FROM products WHERE sku LIKE $2) AS products,(SELECT count(*)::int FROM assets WHERE created_by=ANY($1::uuid[])) AS assetMetadata',
      [ownerIds, `${run}-P-%`],
    );
    const plans = await pool.query(
      "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT c.id FROM customers c WHERE c.owner_id=$1 AND c.archived_at IS NULL AND c.next_followup_at<((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai') ORDER BY c.updated_at DESC,c.id LIMIT 50",
      [ownerIds[0]],
    );
    const databaseTotals = await pool.query(
      'SELECT (SELECT count(*)::int FROM customers) AS customers,(SELECT count(*)::int FROM orders) AS orders,(SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM assets) AS assets',
    );
    const orderPagePlan = await pool.query(
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT o.id,o.created_at FROM orders o JOIN customers c ON c.id=o.customer_id WHERE c.archived_at IS NULL AND c.owner_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 50',
      [ownerIds[0]],
    );
    const orderCountPlan = await pool.query(
      'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*) FROM orders o JOIN customers c ON c.id=o.customer_id WHERE c.archived_at IS NULL AND c.owner_id=$1',
      [ownerIds[0]],
    );
    const report = {
      run,
      startedAt,
      completedAt: new Date().toISOString(),
      scope: 'business_test',
      apiUrl: 'http://127.0.0.1:3001/api/v1',
      hardware: {
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        availableParallelism: availableParallelism(),
        memoryBytes: totalmem(),
        freeMemoryBytes: freemem(),
      },
      network: { transport: 'loopback', throttling: false },
      storage: process.env.BOS_PERF_STORAGE ?? 'unspecified',
      nodeVersion: process.version,
      databaseTotals: databaseTotals.rows[0],
      coreBuildSha256: createHash('sha256')
        .update(await readFile(resolve(root, 'apps/api/dist/core.service.js')))
        .digest('hex'),
      fixture: {
        ...counts.rows[0],
        operators: 20,
        assets: 'metadata_only',
        assetBytesOnDisk: 0,
        maintenance: 'VACUUM ANALYZE after seed',
      },
      samples,
      followupPlan: plans.rows[0]['QUERY PLAN'],
      orderPagePlan: orderPagePlan.rows[0]['QUERY PLAN'],
      orderCountPlan: orderCountPlan.rows[0]['QUERY PLAN'],
    };
    await writeFile(resolve(outputDirectory, `${run}.json`), JSON.stringify(report, null, 2));
    if (samples.some((sample) => !sample.passed)) process.exitCode = 1;
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
