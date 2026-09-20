import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApiClient, apiUrl } from '../tests/api-client';
import { importColumns, XLSX_MIME } from '../apps/api/src/transfer/transfer.types';

const root = process.env.BOS_ROOT || process.cwd();
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const ExcelJS = apiRequire('exceljs');
const { Pool } = apiRequire('pg');
const pool = new Pool({ max: 2 });
const client = new ApiClient();
const run = `import-performance-${randomUUID()}`;
const rowsPerRound = 5000;
const rounds = Number(process.env.BOS_IMPORT_ROUNDS || '3');
const jobs: string[] = [];
const productSkus: string[] = [];
const samples: any[] = [];
const output = resolve(root, '.artifacts/performance', `${run}.json`);

async function waitForJob(id: string) {
  const started = performance.now();
  while (performance.now() - started < 180000) {
    const response = await client.request('GET', `/imports/${id}`);
    if (response.status !== 200) throw new Error(`JOB_READ_FAILED:${response.status}`);
    if (['SUCCEEDED', 'FAILED'].includes(response.body.status)) return response.body;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('JOB_TIMEOUT');
}

async function cleanup() {
  if (process.env.PGDATABASE !== 'business_test') throw new Error('TEST_DATABASE_REQUIRED');
  const records = await pool.query(
    'SELECT id,status,storage_key FROM transfer_jobs WHERE id=ANY($1::uuid[])',
    [jobs],
  );
  if (records.rows.some((row: any) => ['QUEUED', 'RUNNING'].includes(row.status)))
    throw new Error('IMPORT_STILL_RUNNING');
  const products = await pool.query('SELECT id,sku FROM products WHERE sku=ANY($1::text[])', [
    productSkus,
  ]);
  if (products.rows.some((row: any) => !row.sku.startsWith(`${run}-`)))
    throw new Error('CLEANUP_SCOPE_INVALID');
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('DELETE FROM audit_events WHERE entity_id=ANY($1::uuid[])', [
      [...jobs, ...products.rows.map((row: any) => row.id)],
    ]);
    await tx.query('DELETE FROM products WHERE id=ANY($1::uuid[]) AND sku=ANY($2::text[])', [
      products.rows.map((row: any) => row.id),
      productSkus,
    ]);
    await tx.query('DELETE FROM transfer_jobs WHERE id=ANY($1::uuid[])', [jobs]);
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
  const storage = resolve(root, '.data/test-uploads');
  if (!/^D:[\\/]/i.test(storage)) throw new Error('D_DRIVE_REQUIRED');
  for (const row of records.rows) {
    if (!/^[a-f0-9-]{36}(?:\.upload)?$/.test(row.storage_key || ''))
      throw new Error('INVALID_STORAGE_KEY');
    await unlink(resolve(storage, row.storage_key));
  }
}

async function main() {
  if (process.env.PGDATABASE !== 'business_test' || process.env.PGPORT !== '54322')
    throw new Error('TEST_DATABASE_REQUIRED');
  const database = await pool.query('SELECT current_database() AS name');
  if (database.rows[0].name !== 'business_test') throw new Error('TEST_DATABASE_REQUIRED');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw new Error('INVALID_ROUNDS');
  await mkdir(resolve(root, '.artifacts/performance'), { recursive: true });
  await client.login('test-owner', 'TestOwner2026!Local');
  let failure: string | null = null;
  try {
    for (let round = 1; round <= rounds; round += 1) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('数据');
      sheet.columns = Object.entries(importColumns.products).map(([key, header]) => ({
        key,
        header,
      }));
      const skus = Array.from({ length: rowsPerRound }, (_, index) => `${run}-${round}-${index}`);
      productSkus.push(...skus);
      for (const sku of skus)
        sheet.addRow({ sku, name: '导入性能产品', model: 'M1', unit: '件', priceExTax: '123.45' });
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      const body = new FormData();
      body.set('kind', 'products');
      body.set('file', new Blob([bytes], { type: XLSX_MIME }), `${run}-${round}.xlsx`);
      const previewStarted = performance.now();
      const response = await fetch(`${apiUrl}/imports/preview`, {
        method: 'POST',
        headers: {
          cookie: client.cookie,
          'x-csrf-token': client.csrfToken,
          origin: 'http://127.0.0.1:5174',
        },
        body,
      });
      const taskCreationMs = performance.now() - previewStarted;
      const created = await response.json();
      if (response.status !== 201 || !created.jobId)
        throw new Error(`IMPORT_UPLOAD_FAILED:${response.status}`);
      jobs.push(created.jobId);
      const preview = await waitForJob(created.jobId);
      const previewMs = performance.now() - previewStarted;
      if (preview.status !== 'SUCCEEDED' || !preview.previewValid)
        throw new Error(`PREVIEW_FAILED:${JSON.stringify(preview.errors || preview.errorMessage)}`);
      const previewCount = await pool.query(
        'SELECT count(*)::int AS count FROM products WHERE sku=ANY($1::text[])',
        [skus],
      );
      if (previewCount.rows[0].count !== 0) throw new Error('PREVIEW_WROTE_PRODUCTS');
      const commitStarted = performance.now();
      const commitResponse = await client.request('POST', `/imports/${created.jobId}/commit`, {
        idempotencyKey: randomUUID(),
      });
      if (commitResponse.status !== 201)
        throw new Error(`COMMIT_REQUEST_FAILED:${commitResponse.status}`);
      const committed = await waitForJob(created.jobId);
      const commitMs = performance.now() - commitStarted;
      if (committed.status !== 'SUCCEEDED' || committed.createdCount !== rowsPerRound)
        throw new Error(`COMMIT_FAILED:${committed.errorMessage}`);
      const persisted = await pool.query(
        'SELECT count(*)::int AS count FROM products WHERE sku=ANY($1::text[])',
        [skus],
      );
      if (persisted.rows[0].count !== rowsPerRound) throw new Error('PRODUCT_COUNT_MISMATCH');
      const sample = {
        round,
        rows: rowsPerRound,
        bytes: bytes.length,
        taskCreationMs: Math.round(taskCreationMs),
        previewMs: Math.round(previewMs),
        commitMs: Math.round(commitMs),
        passed: taskCreationMs <= 1000 && previewMs <= 10000 && commitMs <= 15000,
      };
      samples.push(sample);
      process.stdout.write(`${JSON.stringify(sample)}\n`);
      await writeFile(
        output,
        JSON.stringify(
          {
            run,
            scope: 'business_test',
            kind: 'products',
            concurrentBackgroundSessions: 0,
            samples,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    failure = (error as Error).message;
    throw error;
  } finally {
    try {
      await cleanup();
    } finally {
      await writeFile(
        output,
        JSON.stringify(
          {
            run,
            scope: 'business_test',
            kind: 'products',
            concurrentBackgroundSessions: 0,
            samples,
            failure,
            completedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      await pool.end();
    }
  }
  if (samples.some((sample) => !sample.passed)) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
  void pool.end().catch(() => undefined);
});
