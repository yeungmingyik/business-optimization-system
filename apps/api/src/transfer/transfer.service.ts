import { Inject, Injectable, OnModuleDestroy, OnModuleInit, HttpException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AuthService, boss, type AuthUser } from '../auth.service';
import { CoreService } from '../core.service';
import { DatabaseService } from '../database.service';
import { checkVersion, fail, pageOf, parse, uuid } from '../validation';
import { spreadsheetTask, storagePath, storageRoot } from './storage';
import { TransferDataService } from './transfer-data.service';
import { transferSchema } from './transfer-schema';
import {
  type SpreadsheetResult,
  type TransferKind,
  type TransferRecord,
  TEMPLATE_VERSION,
  XLSX_MIME,
} from './transfer.types';

const kindSchema = z.enum(['customers', 'products', 'orders']);
const metadataSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  categoryId: uuid.nullable().default(null),
  tagIds: z.array(uuid).max(100).default([]),
  productIds: z.array(uuid).max(100).default([]),
});
type Uploaded = {
  path: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
};
type FileDetails = { mediaType: string; bytes: number; checksum: string; extension: string };

function publicError(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    return typeof response === 'string'
      ? response
      : (response as { message?: string }).message || '数据校验失败';
  }
  if ((error as { code?: string })?.code === '23505') return '记录重复，请检查后重试';
  const message = (error as Error)?.message;
  return message && /^[\u3400-\u9fff]/.test(message) ? message : '任务处理失败，请重试';
}

@Injectable()
export class TransferService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private processing = false;
  private stopping = false;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CoreService) private readonly core: CoreService,
    @Inject(TransferDataService) private readonly data: TransferDataService,
  ) {}

  async onModuleInit() {
    await mkdir(storageRoot(), { recursive: true });
    await this.db.migrate();
    await this.db.query(transferSchema);
    if (process.env.BOS_TRANSFER_WORKER !== 'disabled') {
      this.timer = setInterval(() => {
        void this.tick();
      }, 500);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  async activeActor(user: AuthUser, tx: PoolClient) {
    const current = await this.auth.getActiveUser(user.id, tx);
    if (current.mustChangePassword || current.role !== user.role)
      fail('账号权限已变更，请重新登录', 401);
    return current;
  }

  async assetRow(id: string, tx?: PoolClient, lock = false) {
    parse(uuid, id);
    const { rows } = await this.db.query(
      `SELECT a.*,v.original_name,v.media_type,v.bytes,v.storage_key FROM assets a JOIN asset_versions v ON v.id=a.current_version_id WHERE a.id=$1${lock ? ' FOR UPDATE OF a' : ''}`,
      [id],
      tx,
    );
    if (!rows[0]) fail('资料不存在', 404);
    return rows[0];
  }

  async assetShape(row: any, tx?: PoolClient, cached?: { dictionaries: any[]; products: any[] }) {
    const document = row.document;
    const dictionaryIds = [
      ...document.tagIds,
      ...(document.categoryId ? [document.categoryId] : []),
    ];
    const dictionaries = cached
      ? cached.dictionaries
      : dictionaryIds.length
        ? (
            await this.db.query(
              'SELECT id,name,kind,archived_at AS "archivedAt" FROM dictionaries WHERE id=ANY($1::uuid[])',
              [dictionaryIds],
              tx,
            )
          ).rows
        : [];
    const products = cached
      ? cached.products.filter((product) => document.productIds.includes(product.id))
      : document.productIds.length
        ? (
            await this.db.query(
              'SELECT id,sku,document->>\'name\' AS name,archived_at AS "archivedAt" FROM products WHERE id=ANY($1::uuid[])',
              [document.productIds],
              tx,
            )
          ).rows
        : [];
    return {
      ...document,
      id: row.id,
      version: row.version,
      archivedAt: row.archived_at,
      currentVersionId: row.current_version_id,
      originalName: row.original_name,
      mediaType: row.media_type,
      bytes: Number(row.bytes),
      categoryName: dictionaries.find((item: any) => item.id === document.categoryId)?.name || '',
      tags: dictionaries.filter((item: any) => document.tagIds.includes(item.id)),
      products,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async validateMetadata(input: unknown, tx: PoolClient, existing?: any) {
    const metadata = parse(metadataSchema, input);
    metadata.tagIds = [...new Set(metadata.tagIds)];
    metadata.productIds = [...new Set(metadata.productIds)];
    for (const id of metadata.productIds) {
      const { rows } = await tx.query('SELECT id,archived_at FROM products WHERE id=$1 FOR SHARE', [
        id,
      ]);
      if (!rows[0] || (rows[0].archived_at && !existing?.productIds?.includes(id)))
        fail('请选择有效产品');
    }
    const dictionaryReferences = [
      ...metadata.tagIds.map((id) => ({ id, kind: 'asset-tag' })),
      ...(metadata.categoryId ? [{ id: metadata.categoryId, kind: 'asset-category' }] : []),
    ];
    for (const { id, kind } of dictionaryReferences) {
      const { rows } = await tx.query(
        'SELECT kind,archived_at FROM dictionaries WHERE id=$1 FOR SHARE',
        [id],
      );
      const retained = id === existing?.categoryId || existing?.tagIds?.includes(id);
      if (!rows[0] || rows[0].kind !== kind || (rows[0].archived_at && !retained))
        fail('请选择有效分类或标签');
    }
    return metadata;
  }

  async listAssets(user: AuthUser, query: Record<string, any>) {
    const { page, pageSize } = pageOf(query);
    if (query.archived === 'true') boss(user);
    const conditions = [
      query.archived === 'true' ? 'a.archived_at IS NOT NULL' : 'a.archived_at IS NULL',
    ];
    const parameters: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      parameters.push(value);
      conditions.push(sql.replace('?', `$${parameters.length}`));
    };
    if (query.q) add("a.document->>'name' ILIKE ?", `%${String(query.q).slice(0, 200)}%`);
    if (query.categoryId) add("a.document->>'categoryId'=?", parse(uuid, query.categoryId));
    if (query.tagId)
      add("a.document->'tagIds' @> ?::jsonb", JSON.stringify([parse(uuid, query.tagId)]));
    if (query.productId)
      add("a.document->'productIds' @> ?::jsonb", JSON.stringify([parse(uuid, query.productId)]));
    if (query.mediaType === 'image') conditions.push("v.media_type LIKE 'image/%'");
    else if (query.mediaType === 'video') conditions.push("v.media_type LIKE 'video/%'");
    else if (query.mediaType === 'document')
      conditions.push("v.media_type LIKE 'application/vnd.openxmlformats-officedocument.%'");
    else if (query.mediaType) add('v.media_type=?', String(query.mediaType));
    if (query.customerId) {
      const customer: any = await this.core.getCustomer(user, parse(uuid, query.customerId));
      const names = (customer.tags || []).map((tag: any) => tag.name);
      const tags = names.length
        ? (
            await this.db.query(
              "SELECT id FROM dictionaries WHERE kind='asset-tag' AND name=ANY($1::text[]) AND archived_at IS NULL",
              [names],
            )
          ).rows.map((tag: any) => tag.id)
        : [];
      parameters.push(customer.productIds || [], tags);
      conditions.push(
        `(a.document->'productIds' ?| $${parameters.length - 1}::text[] OR a.document->'tagIds' ?| $${parameters.length}::text[])`,
      );
    }
    const from = `FROM assets a JOIN asset_versions v ON v.id=a.current_version_id WHERE ${conditions.join(' AND ')}`;
    const count = await this.db.query(`SELECT count(*)::int AS count ${from}`, parameters);
    const result = await this.db.query(
      `SELECT a.*,v.original_name,v.media_type,v.bytes ${from} ORDER BY a.updated_at DESC,a.id LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, pageSize, (page - 1) * pageSize],
    );
    const dictionaryIds = [
      ...new Set(
        result.rows.flatMap((row) => [
          ...row.document.tagIds,
          ...(row.document.categoryId ? [row.document.categoryId] : []),
        ]),
      ),
    ];
    const productIds = [...new Set(result.rows.flatMap((row) => row.document.productIds))];
    const dictionaries = dictionaryIds.length
      ? (
          await this.db.query(
            'SELECT id,name,kind,archived_at AS "archivedAt" FROM dictionaries WHERE id=ANY($1::uuid[])',
            [dictionaryIds],
          )
        ).rows
      : [];
    const products = productIds.length
      ? (
          await this.db.query(
            'SELECT id,sku,document->>\'name\' AS name,archived_at AS "archivedAt" FROM products WHERE id=ANY($1::uuid[])',
            [productIds],
          )
        ).rows
      : [];
    return {
      items: await Promise.all(
        result.rows.map((row) => this.assetShape(row, undefined, { dictionaries, products })),
      ),
      total: count.rows[0].count,
      page,
      pageSize,
    };
  }

  async getAsset(user: AuthUser, id: string) {
    const row = await this.assetRow(id);
    const versions = await this.db.query(
      'SELECT id,original_name AS "originalName",media_type AS "mediaType",bytes::float8 AS bytes,created_at AS "createdAt" FROM asset_versions WHERE asset_id=$1 ORDER BY created_at DESC,id',
      [id],
    );
    return {
      ...(await this.assetShape(row)),
      versions: versions.rows,
      canDownload: !row.archived_at || user.role === 'BOSS',
    };
  }

  async createAsset(user: AuthUser, file: Uploaded | undefined, rawMetadata: unknown) {
    if (!file) fail('请选择文件');
    let retained = false;
    let key = file.filename;
    try {
      const details = await spreadsheetTask<FileDetails>({
        action: 'validate',
        path: file.path,
        originalName: file.originalname,
        declaredMime: file.mimetype,
      });
      key = randomUUID();
      await rename(file.path, storagePath(key));
      const id = randomUUID();
      const versionId = randomUUID();
      await this.db.transaction(async (tx) => {
        await this.activeActor(user, tx);
        const metadata = await this.validateMetadata(rawMetadata, tx);
        await tx.query(
          'INSERT INTO assets(id,document,current_version_id,created_by) VALUES($1,$2,$3,$4)',
          [id, metadata, versionId, user.id],
        );
        await tx.query(
          'INSERT INTO asset_versions(id,asset_id,storage_key,original_name,media_type,bytes,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            versionId,
            id,
            key,
            file.originalname,
            details.mediaType,
            details.bytes,
            details.checksum,
            user.id,
          ],
        );
        await this.core.audit(user, 'asset', id, 'create', { name: metadata.name }, tx);
      });
      retained = true;
      return this.getAsset(user, id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      fail(publicError(error));
    } finally {
      if (!retained)
        await Promise.all([
          unlink(storagePath(key)).catch(() => undefined),
          unlink(file.path).catch(() => undefined),
        ]);
    }
  }

  async updateAsset(user: AuthUser, id: string, input: unknown) {
    await this.db.transaction(async (tx) => {
      await this.activeActor(user, tx);
      const row = await this.assetRow(id, tx, true);
      if (row.archived_at && user.role !== 'BOSS') fail('资料已归档', 403);
      checkVersion(row.version, input);
      const metadata = await this.validateMetadata(input, tx, row.document);
      await tx.query(
        'UPDATE assets SET document=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, metadata],
      );
      await this.core.audit(user, 'asset', id, 'update', { name: metadata.name }, tx);
    });
    return this.getAsset(user, id);
  }

  async replaceAsset(user: AuthUser, id: string, file: Uploaded | undefined, version: number) {
    if (!file) fail('请选择文件');
    let retained = false;
    let key = file.filename;
    try {
      const details = await spreadsheetTask<FileDetails>({
        action: 'validate',
        path: file.path,
        originalName: file.originalname,
        declaredMime: file.mimetype,
      });
      key = randomUUID();
      await rename(file.path, storagePath(key));
      await this.db.transaction(async (tx) => {
        await this.activeActor(user, tx);
        const row = await this.assetRow(id, tx, true);
        if (row.archived_at && user.role !== 'BOSS') fail('资料已归档', 403);
        checkVersion(row.version, { version });
        const versionId = randomUUID();
        await tx.query(
          'INSERT INTO asset_versions(id,asset_id,storage_key,original_name,media_type,bytes,checksum,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            versionId,
            id,
            key,
            file.originalname,
            details.mediaType,
            details.bytes,
            details.checksum,
            user.id,
          ],
        );
        await tx.query(
          'UPDATE assets SET current_version_id=$2,version=version+1,updated_at=now() WHERE id=$1',
          [id, versionId],
        );
        await this.core.audit(
          user,
          'asset',
          id,
          'replace',
          { previousVersionId: row.current_version_id, versionId },
          tx,
        );
      });
      retained = true;
      return this.getAsset(user, id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      fail(publicError(error));
    } finally {
      if (!retained)
        await Promise.all([
          unlink(storagePath(key)).catch(() => undefined),
          unlink(file.path).catch(() => undefined),
        ]);
    }
  }

  async archiveAsset(user: AuthUser, id: string, input: unknown, archive: boolean) {
    boss(user);
    await this.db.transaction(async (tx) => {
      await this.activeActor(user, tx);
      const row = await this.assetRow(id, tx, true);
      checkVersion(row.version, input);
      await tx.query(
        'UPDATE assets SET archived_at=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, archive ? new Date() : null],
      );
      await this.core.audit(user, 'asset', id, archive ? 'archive' : 'restore', {}, tx);
    });
    return this.getAsset(user, id);
  }

  async assetDownload(user: AuthUser, id: string, versionId?: string, preview = false) {
    const asset = await this.assetRow(id);
    if (asset.archived_at && user.role !== 'BOSS') fail('资料已归档', 403);
    const { rows } = await this.db.query(
      'SELECT * FROM asset_versions WHERE id=$1 AND asset_id=$2',
      [versionId ? parse(uuid, versionId) : asset.current_version_id, id],
    );
    if (!rows[0]) fail('文件不存在', 404);
    const row = rows[0];
    if (
      preview &&
      !['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(
        row.media_type,
      )
    )
      fail('此文件类型不支持预览');
    return {
      path: storagePath(row.storage_key),
      name: row.original_name,
      mediaType: row.media_type,
      bytes: Number(row.bytes),
    };
  }

  async template(rawKind: unknown) {
    const kind = parse(kindSchema, rawKind);
    const key = randomUUID();
    try {
      await spreadsheetTask({ action: 'template', path: storagePath(key), kind });
    } catch (error) {
      await unlink(storagePath(key)).catch(() => undefined);
      fail(publicError(error));
    }
    return {
      path: storagePath(key),
      name: `${{ customers: '客户', products: '产品', orders: '订单' }[kind]}导入模板.xlsx`,
      mediaType: XLSX_MIME,
      disposable: true,
    };
  }

  async previewImport(user: AuthUser, rawKind: unknown, file: Uploaded | undefined) {
    if (!file) fail('请选择文件');
    let retained = false;
    try {
      const kind = parse(kindSchema, rawKind);
      if (
        !/\.xlsx$/i.test(file.originalname) ||
        ![XLSX_MIME, 'application/octet-stream'].includes(file.mimetype)
      )
        fail('请上传 XLSX 文件');
      if (file.size > 20 * 1024 * 1024) fail('文件不能超过 20 MiB', 413);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file.path)) hash.update(chunk);
      const digest = hash.digest('hex');
      const existing = await this.db.query(
        "SELECT id,status,committed_at FROM transfer_jobs WHERE job_type='IMPORT' AND actor_id=$1 AND kind=$2 AND file_hash=$3 AND template_version=$4",
        [user.id, kind, digest, TEMPLATE_VERSION],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].status === 'FAILED' && !existing.rows[0].committed_at)
          await this.db.query(
            "UPDATE transfer_jobs SET status='QUEUED',phase='PREVIEW',result='{}',error_message=NULL,attempts=0,updated_at=now() WHERE id=$1 AND status='FAILED'",
            [existing.rows[0].id],
          );
        return { jobId: existing.rows[0].id };
      }
      const id = randomUUID();
      const result = await this.db.query(
        "INSERT INTO transfer_jobs(id,job_type,kind,actor_id,phase,storage_key,file_hash,template_version,payload) VALUES($1,'IMPORT',$2,$3,'PREVIEW',$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
        [
          id,
          kind,
          user.id,
          file.filename,
          digest,
          TEMPLATE_VERSION,
          { originalName: file.originalname },
        ],
      );
      retained = Boolean(result.rowCount);
      if (!retained) {
        const duplicate = await this.db.query(
          "SELECT id FROM transfer_jobs WHERE job_type='IMPORT' AND actor_id=$1 AND kind=$2 AND file_hash=$3 AND template_version=$4",
          [user.id, kind, digest, TEMPLATE_VERSION],
        );
        return { jobId: duplicate.rows[0].id };
      }
      return { jobId: id };
    } finally {
      if (!retained) await unlink(file.path).catch(() => undefined);
    }
  }

  async jobRow(
    user: AuthUser,
    id: string,
    jobType: 'IMPORT' | 'EXPORT',
    tx?: PoolClient,
    lock = false,
  ) {
    parse(uuid, id);
    const { rows } = await this.db.query(
      `SELECT transfer_jobs.*,(SELECT display_name FROM users WHERE users.id=transfer_jobs.actor_id) AS actor_name FROM transfer_jobs WHERE id=$1 AND job_type=$2 AND (actor_id=$3 OR $4::boolean)${lock ? ' FOR UPDATE' : ''}`,
      [id, jobType, user.id, user.role === 'BOSS'],
      tx,
    );
    if (!rows[0]) fail('任务不存在', 404);
    return rows[0] as TransferRecord & {
      created_at: Date;
      updated_at: Date;
      expires_at: Date;
      idempotency_key: string | null;
      lease_token: string;
      actor_name: string;
    };
  }

  async validateJobScope(user: AuthUser, row: TransferRecord) {
    const ids = row.result.resourceIds as string[] | undefined;
    if (ids) await this.data.assertScope(user, row.kind, ids);
    const references = row.payload.references as Array<{ table: string; id: string }> | undefined;
    for (const kind of ['customers', 'orders'] as const) {
      const referencedIds = [
        ...new Set(
          references
            ?.filter((reference) => reference.table === kind)
            .map((reference) => reference.id) || [],
        ),
      ];
      if (referencedIds.length) await this.data.assertScope(user, kind, referencedIds);
    }
  }

  async getJob(user: AuthUser, id: string, type: 'IMPORT' | 'EXPORT') {
    const row = await this.jobRow(user, id, type);
    await this.validateJobScope(user, row);
    const { resourceIds, references, rows, ...result } = row.result;
    return {
      ...result,
      id: row.id,
      jobId: row.id,
      kind: row.kind,
      actorId: row.actor_id,
      actorName: row.actor_name,
      canCommit:
        type === 'IMPORT' &&
        row.actor_id === user.id &&
        row.phase === 'PREVIEW' &&
        row.status === 'SUCCEEDED' &&
        row.result.previewValid === true &&
        !row.committed_at,
      filename: row.payload.originalName || '',
      status: row.status,
      phase: row.phase,
      errorMessage: row.error_message,
      committedAt: row.committed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listJobs(user: AuthUser, type: 'IMPORT' | 'EXPORT', query: Record<string, string>) {
    const { page, pageSize } = pageOf(query);
    const values: unknown[] = [user.role === 'BOSS' ? null : user.id, type];
    const conditions = ['($1::uuid IS NULL OR actor_id=$1)', 'job_type=$2'];
    if (user.role === 'BOSS' && query.actorId) {
      values.push(parse(uuid, query.actorId));
      conditions.push(`actor_id=$${values.length}`);
    }
    if (query.kind) {
      values.push(parse(kindSchema, query.kind));
      conditions.push(`kind=$${values.length}`);
    }
    if (query.status) {
      values.push(parse(z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']), query.status));
      conditions.push(`status=$${values.length}`);
    }
    if (user.role !== 'BOSS') {
      conditions.push(`(kind='products' OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(coalesce(result->'resourceIds','[]'::jsonb)) resource(id)
        WHERE (kind='customers' AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id::text=resource.id AND c.owner_id=$1))
          OR (kind='orders' AND NOT EXISTS(SELECT 1 FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id::text=resource.id AND c.owner_id=$1))
      ))`);
      conditions.push(`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(payload->'references','[]'::jsonb)) reference
        WHERE (reference->>'table'='customers' AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id::text=reference->>'id' AND c.owner_id=$1))
          OR (reference->>'table'='orders' AND NOT EXISTS(SELECT 1 FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id::text=reference->>'id' AND c.owner_id=$1))
      )`);
    }
    const where = conditions.join(' AND ');
    const total = await this.db.query(
      `SELECT count(*)::int AS count FROM transfer_jobs WHERE ${where}`,
      values,
    );
    const { rows } = await this.db.query(
      `SELECT j.id,j.actor_id,u.display_name AS actor_name,kind,status,phase,payload->>'originalName' AS filename,result,error_message,committed_at,j.created_at,j.updated_at FROM transfer_jobs j JOIN users u ON u.id=j.actor_id WHERE ${where} ORDER BY j.created_at DESC,j.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        jobId: row.id,
        kind: row.kind,
        actorId: row.actor_id,
        actorName: row.actor_name,
        canCommit:
          type === 'IMPORT' &&
          row.actor_id === user.id &&
          row.phase === 'PREVIEW' &&
          row.status === 'SUCCEEDED' &&
          row.result.previewValid === true &&
          !row.committed_at,
        filename: row.filename || '',
        status: row.status,
        phase: row.phase,
        previewValid: row.result.previewValid,
        rowCount: row.result.rowCount,
        createdCount: row.result.createdCount,
        errorMessage: row.error_message,
        committedAt: row.committed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: total.rows[0].count,
      page,
      pageSize,
    };
  }

  async commitImport(user: AuthUser, id: string, input: unknown) {
    const { idempotencyKey } = parse(z.object({ idempotencyKey: uuid }), input);
    const jobId = await this.db.transaction(async (tx) => {
      await this.activeActor(user, tx);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${user.id}:${idempotencyKey}`,
      ]);
      const repeated = await tx.query(
        'SELECT id FROM transfer_jobs WHERE actor_id=$1 AND idempotency_key=$2',
        [user.id, idempotencyKey],
      );
      if (repeated.rows[0]) {
        if (repeated.rows[0].id !== id) fail('提交标识已用于其他批次', 409, 'IDEMPOTENCY_CONFLICT');
        return repeated.rows[0].id as string;
      }
      const row = await this.jobRow(user, id, 'IMPORT', tx, true);
      if (row.actor_id !== user.id) fail('只能提交本人导入任务', 403);
      if (
        row.committed_at ||
        (row.phase === 'COMMIT' && ['QUEUED', 'RUNNING'].includes(row.status))
      )
        return id;
      if (row.status !== 'SUCCEEDED' || row.phase !== 'PREVIEW' || !row.result.previewValid)
        fail('请先完成预检');
      await tx.query(
        "UPDATE transfer_jobs SET phase='COMMIT',status='QUEUED',idempotency_key=$2,error_message=NULL,attempts=0,updated_at=now() WHERE id=$1",
        [id, idempotencyKey],
      );
      return id;
    });
    return { jobId };
  }

  async importErrors(user: AuthUser, id: string) {
    const row = await this.jobRow(user, id, 'IMPORT');
    await this.validateJobScope(user, row);
    const key = randomUUID();
    const errors = [
      ...((row.result.errors as any[]) || []),
      ...((row.result.duplicates as any[]) || []),
    ];
    try {
      await spreadsheetTask({
        action: 'write',
        path: storagePath(key),
        columns: [
          { key: 'row', header: '行号' },
          { key: 'field', header: '字段' },
          { key: 'message', header: '错误' },
        ],
        rows: errors,
      });
    } catch (error) {
      await unlink(storagePath(key)).catch(() => undefined);
      fail(publicError(error));
    }
    return {
      path: storagePath(key),
      name: '导入校验结果.xlsx',
      mediaType: XLSX_MIME,
      disposable: true,
    };
  }

  async createExport(user: AuthUser, input: unknown) {
    const { kind, filters } = parse(
      z.object({ kind: kindSchema, filters: z.record(z.unknown()).default({}) }),
      input,
    );
    const id = randomUUID();
    await this.db.query(
      "INSERT INTO transfer_jobs(id,job_type,kind,actor_id,phase,payload) VALUES($1,'EXPORT',$2,$3,'EXPORT',$4)",
      [id, kind, user.id, { filters }],
    );
    return { jobId: id };
  }

  async exportDownload(user: AuthUser, id: string) {
    const row = await this.jobRow(user, id, 'EXPORT');
    if (row.status !== 'SUCCEEDED' || !row.storage_key) fail('文件尚未生成');
    if (new Date(row.expires_at).getTime() <= Date.now()) fail('文件已过期，请重新导出', 410);
    await this.validateJobScope(user, row);
    return {
      path: storagePath(row.storage_key),
      name: `${{ customers: '客户', products: '产品', orders: '订单' }[row.kind]}导出.xlsx`,
      mediaType: XLSX_MIME,
    };
  }

  async tick() {
    if (this.processing || this.stopping) return;
    this.processing = true;
    let job: any;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      const token = randomUUID();
      const claimed = await this.db.query(
        "WITH candidate AS (SELECT id FROM transfer_jobs WHERE (status='QUEUED' OR (status='RUNNING' AND lease_until<now())) AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE transfer_jobs j SET status='RUNNING',lease_until=now()+interval '3 minutes',lease_token=$1,attempts=attempts+1,updated_at=now() FROM candidate WHERE j.id=candidate.id RETURNING j.*",
        [token],
      );
      job = claimed.rows[0];
      if (!job) {
        await this.db.query(
          "UPDATE transfer_jobs SET status='FAILED',error_message='任务中断，请重试',updated_at=now() WHERE status='RUNNING' AND lease_until<now() AND attempts>=3",
        );
        return;
      }
      heartbeat = setInterval(() => {
        void this.db
          .query(
            "UPDATE transfer_jobs SET lease_until=now()+interval '3 minutes' WHERE id=$1 AND lease_token=$2 AND status='RUNNING'",
            [job.id, token],
          )
          .catch(() => undefined);
      }, 30000);
      heartbeat.unref();
      const actor = await this.auth.getActiveUser(job.actor_id);
      if (actor.mustChangePassword) fail('请先修改密码', 403);
      if (job.phase === 'PREVIEW') {
        const parsed = await spreadsheetTask<SpreadsheetResult>({
          action: 'parse',
          path: storagePath(job.storage_key),
          kind: job.kind,
        });
        const preview = parsed.errors.length
          ? { errors: parsed.errors, duplicates: [], validRows: 0, expectedNew: 0, references: [] }
          : await this.data.preview(job.kind, parsed.rows, actor.id);
        const { references, ...summary } = preview;
        await this.db.query(
          "UPDATE transfer_jobs SET status='SUCCEEDED',result=$2,payload=payload||$3::jsonb,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$4",
          [
            job.id,
            { ...summary, rowCount: parsed.rowCount, previewValid: !preview.errors.length },
            { rows: parsed.rows, references },
            token,
          ],
        );
      } else if (job.phase === 'COMMIT') {
        await this.db.transaction(async (tx) => {
          const locked = await tx.query('SELECT * FROM transfer_jobs WHERE id=$1 FOR UPDATE', [
            job.id,
          ]);
          const current = locked.rows[0];
          if (current.committed_at || current.lease_token !== token) return;
          const result = await this.data.commit(
            job.kind,
            current.payload.rows,
            actor.id,
            current.payload.references || [],
            tx,
          );
          await this.core.audit(
            actor,
            'import',
            job.id,
            'commit',
            { kind: job.kind, createdCount: result.createdCount },
            tx,
          );
          await tx.query(
            "UPDATE transfer_jobs SET status='SUCCEEDED',result=result||$2::jsonb,committed_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1",
            [job.id, result],
          );
        });
      } else {
        const output = await this.data.exportRows(actor, job.kind, job.payload.filters || {});
        const key = randomUUID();
        try {
          await spreadsheetTask({
            action: 'write',
            path: storagePath(key),
            columns: output.columns,
            rows: output.rows,
          });
          const saved = await this.db.query(
            "UPDATE transfer_jobs SET status='SUCCEEDED',storage_key=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$4",
            [job.id, key, { rowCount: output.rows.length, resourceIds: output.resourceIds }, token],
          );
          if (!saved.rowCount) await unlink(storagePath(key)).catch(() => undefined);
        } catch (error) {
          await unlink(storagePath(key)).catch(() => undefined);
          throw error;
        }
      }
    } catch (error) {
      if (job) {
        const response = error instanceof HttpException ? error.getResponse() : null;
        const errors =
          response && typeof response === 'object' ? (response as any).errors : undefined;
        await this.db
          .query(
            "UPDATE transfer_jobs SET status='FAILED',error_message=$2,result=result||$4::jsonb,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$3 AND committed_at IS NULL",
            [
              job.id,
              publicError(error),
              job.lease_token,
              errors ? { errors, createdCount: 0 } : {},
            ],
          )
          .catch(() => undefined);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.processing = false;
    }
  }
}
