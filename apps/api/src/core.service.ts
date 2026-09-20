import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { AuthService, AuthUser, boss, userRow } from './auth.service';
import { DatabaseService } from './database.service';
import {
  amount,
  formatAmount,
  cents,
  channels,
  checkVersion,
  customerSchema,
  dayRange,
  fail,
  followupSchema,
  notFuture,
  orderSchema,
  pageOf,
  parse,
  productSchema,
  required,
  shipmentSchema,
  timestamp,
  uuid,
  versioned,
} from './validation';

@Injectable()
export class CoreService {
  constructor(
    @Inject(DatabaseService) readonly db: DatabaseService,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  async write<T>(
    user: AuthUser,
    tx: PoolClient | undefined,
    fn: (client: PoolClient) => Promise<T>,
  ) {
    const execute = async (client: PoolClient) => {
      const current = await this.auth.getActiveUser(user.id, client);
      if (current.role !== user.role) fail('账号权限已变更，请重新登录', 401);
      return fn(client);
    };
    return tx ? execute(tx) : this.db.transaction(execute);
  }
  async audit(
    user: AuthUser,
    entityType: string,
    entityId: string,
    operation: string,
    changes: any,
    tx?: PoolClient,
  ) {
    await this.db.query(
      'INSERT INTO audit_events(id,actor_id,entity_type,entity_id,operation,changes) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(), user.id, entityType, entityId, operation, JSON.stringify(changes)],
      tx,
    );
  }
  shape(row: any) {
    return {
      ...row.document,
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? null,
      ...(row.customer_no ? { customerNo: row.customer_no } : {}),
      ...(row.owner_id ? { ownerId: row.owner_id, ownerName: row.owner_name } : {}),
      ...(row.order_no
        ? {
            orderNo: row.order_no,
            customerId: row.customer_id,
            status: row.status,
            type: row.type,
            paidAt: row.paid_at,
            totalInclTax: row.total_incl_tax,
            orderDate:
              typeof row.order_date === 'string'
                ? row.order_date
                : new Date(row.order_date).toLocaleDateString('en-CA'),
            customerName: row.customer_name,
            customerNo: row.customer_no,
          }
        : {}),
      ...(row.merchant_name ? { merchantAccountName: row.merchant_name } : {}),
    };
  }
  async enabledOwner(id: string, tx: PoolClient) {
    if (
      !(
        await tx.query("SELECT id FROM users WHERE id=$1 AND account_status='ACTIVE' FOR SHARE", [
          id,
        ])
      ).rowCount
    )
      fail('负责人不可用');
  }
  async references(data: any, previous: any, tx: PoolClient, categoryKind?: string) {
    for (const key of ['productIds', 'tagIds', 'assetIds'] as const) {
      if (!Array.isArray(data[key])) continue;
      if (new Set(data[key]).size !== data[key].length) fail('关联项不能重复');
      for (const id of data[key]) {
        if (previous?.[key]?.includes(id)) continue;
        const table =
          key === 'productIds' ? 'products' : key === 'tagIds' ? 'dictionaries' : 'assets';
        const kind =
          key === 'tagIds'
            ? categoryKind === 'product-category'
              ? 'product-tag'
              : 'customer-tag'
            : null;
        const found = await tx.query(
          `SELECT id FROM ${table} WHERE id=$1 AND archived_at IS NULL${kind ? ' AND kind=$2' : ''} FOR SHARE`,
          kind ? [id, kind] : [id],
        );
        if (!found.rowCount) fail('关联项已归档或不可用');
      }
    }
    if (
      data.categoryId &&
      data.categoryId !== previous?.categoryId &&
      !(
        await tx.query(
          'SELECT id FROM dictionaries WHERE id=$1 AND kind=$2 AND archived_at IS NULL FOR SHARE',
          [data.categoryId, categoryKind],
        )
      ).rowCount
    )
      fail('分类不可用');
  }
  async listUsers(user: AuthUser, query: any) {
    boss(user);
    const { page, pageSize } = pageOf(query);
    const values: any[] = [`%${String(query.q ?? '')}%`];
    const conditions = ['(login_name ILIKE $1 OR display_name ILIKE $1)'];
    if (query.role) {
      values.push(parse(z.enum(['BOSS', 'OPERATOR']), query.role));
      conditions.push(`role=$${values.length}`);
    }
    if (query.accountStatus) {
      values.push(parse(z.enum(['ACTIVE', 'DISABLED']), query.accountStatus));
      conditions.push(`account_status=$${values.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageValues = [...values, pageSize, (page - 1) * pageSize];
    const [rows, count] = await Promise.all([
      this.db.query(
        `SELECT * FROM users ${where} ORDER BY created_at,id LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
        pageValues,
      ),
      this.db.query(`SELECT count(*)::int AS total FROM users ${where}`, values),
    ]);
    return { items: rows.rows.map(userRow), total: count.rows[0].total, page, pageSize };
  }
  async createUser(user: AuthUser, input: any) {
    boss(user);
    const data = parse(
      z.object({
        loginName: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_.-]{3,60}$/),
        displayName: required,
        role: z.enum(['BOSS', 'OPERATOR']),
      }),
      input,
    );
    const temporaryPassword = `Yj${randomBytes(12).toString('base64url')}8`;
    return this.write(user, undefined, async (tx) => {
      const id = randomUUID();
      const result = await tx.query(
        'INSERT INTO users(id,login_name,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [
          id,
          data.loginName,
          data.displayName,
          await this.auth.hashPassword(temporaryPassword),
          data.role,
        ],
      );
      await this.audit(
        user,
        'user',
        id,
        '创建账号',
        { role: data.role, loginName: data.loginName },
        tx,
      );
      return { user: userRow(result.rows[0]), temporaryPassword };
    });
  }
  async updateUser(user: AuthUser, id: string, input: any) {
    boss(user);
    parse(uuid, id);
    const data = parse(
      z.object({
        version: z.number().int().positive(),
        displayName: required.optional(),
        role: z.enum(['BOSS', 'OPERATOR']).optional(),
        accountStatus: z.enum(['ACTIVE', 'DISABLED']).optional(),
      }),
      input,
    );
    return this.write(user, undefined, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(739202)');
      const row = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) fail('账号不存在', 404);
      checkVersion(row.version, input);
      const role = data.role ?? row.role;
      const status = data.accountStatus ?? row.account_status;
      if (
        row.role === 'BOSS' &&
        row.account_status === 'ACTIVE' &&
        (role !== 'BOSS' || status !== 'ACTIVE') &&
        (
          await tx.query(
            "SELECT count(*)::int AS count FROM users WHERE role='BOSS' AND account_status='ACTIVE'",
          )
        ).rows[0].count <= 1
      )
        fail('至少保留一名启用的老板');
      const result = await tx.query(
        'UPDATE users SET display_name=$2,role=$3,account_status=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
        [id, data.displayName ?? row.display_name, role, status],
      );
      if (role !== row.role || status !== row.account_status)
        await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [id]);
      await this.audit(
        user,
        'user',
        id,
        '更新账号',
        { role, accountStatus: status, displayName: data.displayName ?? row.display_name },
        tx,
      );
      return userRow(result.rows[0]);
    });
  }
  async resetPassword(user: AuthUser, id: string, input: any) {
    boss(user);
    parse(uuid, id);
    const temporaryPassword = `Yj${randomBytes(12).toString('base64url')}8`;
    return this.write(user, undefined, async (tx) => {
      const row = (await tx.query('SELECT version FROM users WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row) fail('账号不存在', 404);
      checkVersion(row.version, input);
      await tx.query(
        'UPDATE users SET password_hash=$2,must_change_password=true,version=version+1,updated_at=now() WHERE id=$1',
        [id, await this.auth.hashPassword(temporaryPassword)],
      );
      await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [id]);
      await this.audit(user, 'user', id, '重置密码', {}, tx);
      return { temporaryPassword };
    });
  }
  async listMerchantAccounts(user: AuthUser, query: any, tx?: PoolClient) {
    const { page, pageSize } = pageOf(query);
    const conditions = [
      user.role === 'BOSS' && query.includeArchived === 'true' ? 'true' : 'enabled=true',
    ];
    const values: any[] = [];
    if (query.q) {
      values.push(`%${String(query.q).slice(0, 200)}%`);
      conditions.push(`(name ILIKE $${values.length} OR platform ILIKE $${values.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM merchant_accounts ${where}`,
      values,
      tx,
    );
    const pageValues = [...values, pageSize, (page - 1) * pageSize];
    const result = await this.db.query(
      `SELECT * FROM merchant_accounts ${where} ORDER BY name,id LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
      pageValues,
      tx,
    );
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        platform: r.platform,
        enabled: r.enabled,
        version: r.version,
      })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async saveMerchantAccount(user: AuthUser, input: any, id?: string) {
    boss(user);
    const data = parse(
      z.object({ name: required, platform: z.enum(channels), enabled: z.boolean().default(true) }),
      input,
    );
    return this.write(user, undefined, async (tx) => {
      if (id) {
        parse(uuid, id);
        const previous = (
          await tx.query('SELECT * FROM merchant_accounts WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        if (!previous) fail('账号不存在', 404);
        checkVersion(previous.version, input);
      }
      const result = id
        ? await tx.query(
            'UPDATE merchant_accounts SET name=$2,platform=$3,enabled=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
            [id, data.name, data.platform, data.enabled],
          )
        : await tx.query(
            'INSERT INTO merchant_accounts(id,name,platform,enabled) VALUES($1,$2,$3,$4) RETURNING *',
            [randomUUID(), data.name, data.platform, data.enabled],
          );
      const r = result.rows[0];
      await this.audit(
        user,
        'merchantAccount',
        r.id,
        id ? '修改商家账号' : '创建商家账号',
        data,
        tx,
      );
      return {
        id: r.id,
        name: r.name,
        platform: r.platform,
        enabled: r.enabled,
        version: r.version,
      };
    });
  }
  async listDictionaries(user: AuthUser, query: any, tx?: PoolClient) {
    const { page, pageSize } = pageOf(query);
    const values: any[] = [];
    const where = [query.archived === 'true' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
    if (query.kind) {
      values.push(query.kind);
      where.push('kind=$1');
    }
    if (query.q) {
      values.push(`%${String(query.q).slice(0, 200)}%`);
      where.push(`name ILIKE $${values.length}`);
    }
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM dictionaries WHERE ${where.join(' AND ')}`,
      values,
      tx,
    );
    values.push(pageSize, (page - 1) * pageSize);
    const result = await this.db.query(
      `SELECT * FROM dictionaries WHERE ${where.join(' AND ')} ORDER BY name,id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
      tx,
    );
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        version: r.version,
        archivedAt: r.archived_at,
      })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async saveDictionary(user: AuthUser, input: any, id?: string) {
    const data = parse(
      z.object({
        name: required,
        kind: z
          .enum(['customer-tag', 'product-category', 'product-tag', 'asset-category', 'asset-tag'])
          .optional(),
      }),
      input,
    );
    return this.write(user, undefined, async (tx) => {
      if (id) {
        parse(uuid, id);
        const row = (await tx.query('SELECT * FROM dictionaries WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        if (!row) fail('选项不存在', 404);
        checkVersion(row.version, input);
      } else if (!data.kind) fail('请选择分类');
      const result = id
        ? await tx.query(
            'UPDATE dictionaries SET name=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',
            [id, data.name],
          )
        : await tx.query('INSERT INTO dictionaries(id,kind,name) VALUES($1,$2,$3) RETURNING *', [
            randomUUID(),
            data.kind,
            data.name,
          ]);
      const r = result.rows[0];
      await this.audit(
        user,
        'dictionary',
        r.id,
        id ? '重命名' : '新增',
        { name: r.name, kind: r.kind },
        tx,
      );
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        version: r.version,
        archivedAt: r.archived_at,
      };
    });
  }
  async archiveDictionary(user: AuthUser, id: string, input: any, archive: boolean) {
    boss(user);
    parse(uuid, id);
    return this.write(user, undefined, async (tx) => {
      const row = (await tx.query('SELECT * FROM dictionaries WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row) fail('选项不存在', 404);
      checkVersion(row.version, input);
      await tx.query(
        'UPDATE dictionaries SET archived_at=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, archive ? new Date() : null],
      );
      await this.audit(user, 'dictionary', id, archive ? '归档' : '恢复', {}, tx);
      return { ok: true };
    });
  }
  async customerRow(user: AuthUser, id: string, tx?: PoolClient, lock = false) {
    parse(uuid, id);
    const row = (
      await this.db.query(
        `SELECT c.*,u.display_name AS owner_name,m.name AS merchant_name FROM customers c JOIN users u ON u.id=c.owner_id JOIN merchant_accounts m ON m.id=c.merchant_account_id WHERE c.id=$1 AND ($2::boolean OR c.owner_id=$3)${lock ? ' FOR UPDATE OF c' : ''}`,
        [id, user.role === 'BOSS', user.id],
        tx,
      )
    ).rows[0];
    if (!row) fail('客户不存在', 404, 'NOT_FOUND');
    return row;
  }
  async getCustomer(user: AuthUser, id: string, tx?: PoolClient) {
    const row = await this.customerRow(user, id, tx);
    const data = this.shape(row);
    const [products, tags] = await Promise.all([
      this.db.query(
        'SELECT id,sku,document,archived_at FROM products WHERE id=ANY($1::uuid[])',
        [data.productIds ?? []],
        tx,
      ),
      this.db.query(
        'SELECT id,name,archived_at FROM dictionaries WHERE id=ANY($1::uuid[])',
        [data.tagIds ?? []],
        tx,
      ),
    ]);
    return {
      ...data,
      products: products.rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.document.name,
        archivedAt: r.archived_at,
      })),
      tags: tags.rows.map((r) => ({ id: r.id, name: r.name, archivedAt: r.archived_at })),
    };
  }
  async customerShapes(rows: any[], tx?: PoolClient) {
    const productIds = [...new Set(rows.flatMap((row) => row.document.productIds ?? []))];
    const tagIds = [...new Set(rows.flatMap((row) => row.document.tagIds ?? []))];
    const [products, tags] = await Promise.all([
      this.db.query(
        'SELECT id,sku,document->>\'name\' AS name,archived_at AS "archivedAt" FROM products WHERE id=ANY($1::uuid[])',
        [productIds],
        tx,
      ),
      this.db.query(
        'SELECT id,name,archived_at AS "archivedAt" FROM dictionaries WHERE id=ANY($1::uuid[])',
        [tagIds],
        tx,
      ),
    ]);
    const productMap = new Map(products.rows.map((row) => [row.id, row]));
    const tagMap = new Map(tags.rows.map((row) => [row.id, row]));
    return rows.map((row) => ({
      ...this.shape(row),
      products: (row.document.productIds ?? [])
        .map((id: string) => productMap.get(id))
        .filter(Boolean),
      tags: (row.document.tagIds ?? []).map((id: string) => tagMap.get(id)).filter(Boolean),
    }));
  }
  customerFilter(user: AuthUser, query: any) {
    const params: any[] = [];
    const add = (value: any) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [
      query.archived === 'true' ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL',
    ];
    if (user.role !== 'BOSS') where.push(`c.owner_id=${add(user.id)}`);
    else if (query.ownerId) where.push(`c.owner_id=${add(parse(uuid, query.ownerId))}`);
    if (query.q) {
      const p = add(`%${String(query.q).slice(0, 200)}%`);
      where.push(
        `(c.customer_no ILIKE ${p} OR c.document->>'companyName' ILIKE ${p} OR c.document->>'contactName' ILIKE ${p} OR c.document->>'contactPhone' ILIKE ${p} OR c.document->>'wechatId' ILIKE ${p} OR c.document->>'wechatName' ILIKE ${p} OR c.document->>'taobaoId' ILIKE ${p} OR c.document->>'douyinId' ILIKE ${p})`,
      );
    }
    for (const key of ['sourceChannel', 'status'])
      if (query[key]) where.push(`c.document->>'${key}'=${add(query[key])}`);
    if (query.merchantAccountId)
      where.push(`c.merchant_account_id=${add(parse(uuid, query.merchantAccountId))}`);
    for (const [key, field] of [
      ['productId', 'productIds'],
      ['tagId', 'tagIds'],
    ])
      if (query[key]) where.push(`c.document->'${field}' ? ${add(parse(uuid, query[key]))}`);
    if (query.view === 'pending') where.push("c.followup_status IN ('待跟进','已报价','待付款')");
    const range = dayRange(query, query.view === 'recent_deals');
    if (query.view === 'recent_deals') {
      where.push("c.document->>'status'='已付款'");
      if (range.start) where.push(`c.last_deal_at>=${add(range.start)}`);
      if (range.end) where.push(`c.last_deal_at<${add(range.end)}`);
    } else if (range.start || range.end) {
      if (range.start) where.push(`c.next_followup_at>=${add(range.start)}`);
      if (range.end) where.push(`c.next_followup_at<${add(range.end)}`);
    }
    const today =
      "(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')";
    if (query.followup === 'overdue') where.push(`c.next_followup_at<${today}`);
    if (query.followup === 'today') where.push(`c.next_followup_at<${today}+interval '1 day'`);
    if (query.followup === 'future') where.push(`c.next_followup_at>=${today}+interval '1 day'`);
    return { params, where: where.join(' AND ') };
  }
  async listCustomers(user: AuthUser, query: any = {}, tx?: PoolClient) {
    const { params, where } = this.customerFilter(user, query);
    const { page, pageSize } = pageOf(query);
    const sortMap: Record<string, string> = {
      updatedAt: 'c.updated_at',
      createdAt: 'c.created_at',
      contactName: "c.document->>'contactName'",
      lastDealAt: "c.document->>'lastDealAt'",
      nextFollowupAt: "c.document->>'nextFollowupAt'",
    };
    const sort = sortMap[query.sort] ?? 'c.updated_at';
    const order = query.order === 'asc' ? 'ASC' : 'DESC';
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM customers c WHERE ${where}`,
      params,
      tx,
    );
    const p = [...params, pageSize, (page - 1) * pageSize];
    const result = await this.db.query(
      `SELECT c.*,u.display_name AS owner_name,m.name AS merchant_name FROM customers c JOIN users u ON u.id=c.owner_id JOIN merchant_accounts m ON m.id=c.merchant_account_id WHERE ${where} ORDER BY ${sort} ${order} NULLS LAST,c.id LIMIT $${p.length - 1} OFFSET $${p.length}`,
      p,
      tx,
    );
    return {
      items: await this.customerShapes(result.rows, tx),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async validateCustomer(user: AuthUser, data: any, previous: any, tx: PoolClient, id?: string) {
    const identityKeys = ['taobaoId', 'wechatId', 'douyinId']
      .filter((field) => data[field])
      .map((field) => `${data.merchantAccountId}:${field}:${data[field]}`)
      .sort();
    for (const identityKey of identityKeys)
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identityKey]);
    notFuture(data.lastDealAt);
    if (data.status === '已付款' && !data.lastDealAt) fail('请填写最近成交时间');
    if (
      previous &&
      ((previous.status === '已付款' && data.status !== '已付款') ||
        (previous.lastDealAt &&
          (!data.lastDealAt || Date.parse(data.lastDealAt) < Date.parse(previous.lastDealAt))))
    )
      fail('成交信息更正需由老板填写原因');
    if (
      data.merchantAccountId !== previous?.merchantAccountId &&
      !(
        await tx.query('SELECT id FROM merchant_accounts WHERE id=$1 AND enabled=true FOR SHARE', [
          data.merchantAccountId,
        ])
      ).rowCount
    )
      fail('所属账号不可用');
    await this.references(data, previous, tx);
    for (const field of ['taobaoId', 'wechatId', 'douyinId'])
      if (data[field]) {
        const found = await tx.query(
          `SELECT id FROM customers WHERE merchant_account_id=$1 AND document->>'${field}'=$2 AND ($3::boolean OR owner_id=$4) AND ($5::uuid IS NULL OR id<>$5)`,
          [data.merchantAccountId, data[field], user.role === 'BOSS', user.id, id ?? null],
        );
        if (found.rowCount) fail('同一所属账号的平台标识已存在', 409, 'DUPLICATE');
      }
  }
  async createCustomer(user: AuthUser, input: any, tx?: PoolClient) {
    const data = parse(customerSchema, input);
    return this.write(user, tx, async (client) => {
      const ownerId = user.role === 'BOSS' ? (data.ownerId ?? user.id) : user.id;
      await this.enabledOwner(ownerId, client);
      await this.validateCustomer(user, data, null, client);
      const id = randomUUID();
      const document = { ...data, ownerId: undefined };
      await client.query(
        'INSERT INTO customers(id,owner_id,merchant_account_id,document) VALUES($1,$2,$3,$4)',
        [id, ownerId, data.merchantAccountId, JSON.stringify(document)],
      );
      await this.audit(user, 'customer', id, '创建客户', { ownerId, status: data.status }, client);
      return this.getCustomer(user, id, client);
    });
  }
  async updateCustomer(user: AuthUser, id: string, input: any) {
    return this.write(user, undefined, async (tx) => {
      const row = await this.customerRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (row.archived_at) fail('归档客户不可修改');
      const data = parse(customerSchema, { ...row.document, ...input, ownerId: row.owner_id });
      await this.validateCustomer(user, data, row.document, tx, id);
      await tx.query(
        'UPDATE customers SET document=$2,merchant_account_id=$3,version=version+1,updated_at=now() WHERE id=$1',
        [id, JSON.stringify({ ...data, ownerId: undefined }), data.merchantAccountId],
      );
      await this.audit(
        user,
        'customer',
        id,
        '修改客户',
        {
          before: { status: row.document.status, lastDealAt: row.document.lastDealAt },
          after: { status: data.status, lastDealAt: data.lastDealAt },
          fields: Object.keys(input).filter((k) => k !== 'version'),
        },
        tx,
      );
      return this.getCustomer(user, id, tx);
    });
  }
  async correctCustomerDeal(user: AuthUser, id: string, input: any) {
    boss(user);
    const data = parse(
      z.object({
        status: z.enum(['待跟进', '已报价', '待付款', '已付款']),
        lastDealAt: timestamp,
        reason: required,
      }),
      input,
    );
    notFuture(data.lastDealAt);
    if (data.status === '已付款' && !data.lastDealAt) fail('请填写最近成交时间');
    return this.write(user, undefined, async (tx) => {
      const row = await this.customerRow(user, id, tx, true);
      checkVersion(row.version, input);
      await tx.query(
        'UPDATE customers SET document=document||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1',
        [id, JSON.stringify({ status: data.status, lastDealAt: data.lastDealAt })],
      );
      await this.audit(
        user,
        'customer',
        id,
        '更正成交信息',
        {
          before: { status: row.document.status, lastDealAt: row.document.lastDealAt },
          after: data,
        },
        tx,
      );
      return this.getCustomer(user, id, tx);
    });
  }
  async assignCustomer(user: AuthUser, id: string, input: any) {
    boss(user);
    const ownerId = parse(uuid, input.ownerId);
    return this.write(user, undefined, async (tx) => {
      const row = await this.customerRow(user, id, tx, true);
      checkVersion(row.version, input);
      await this.enabledOwner(ownerId, tx);
      await tx.query(
        'UPDATE customers SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, ownerId],
      );
      await tx.query('UPDATE orders SET version=version+1,updated_at=now() WHERE customer_id=$1', [
        id,
      ]);
      const counts = (
        await tx.query(
          'SELECT (SELECT count(*) FROM orders WHERE customer_id=$1)::int AS orders,(SELECT count(*) FROM followups WHERE customer_id=$1)::int AS followups',
          [id],
        )
      ).rows[0];
      await this.audit(
        user,
        'customer',
        id,
        '转交客户',
        { previousOwnerId: row.owner_id, ownerId, ...counts },
        tx,
      );
      return this.getCustomer(user, id, tx);
    });
  }
  async archiveCustomer(user: AuthUser, id: string, input: any, archive: boolean) {
    boss(user);
    return this.write(user, undefined, async (tx) => {
      const row = await this.customerRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (
        archive &&
        (
          await tx.query("SELECT id FROM orders WHERE customer_id=$1 AND status='待付款' LIMIT 1", [
            id,
          ])
        ).rowCount
      )
        fail('请先处理待付款订单');
      await tx.query(
        'UPDATE customers SET archived_at=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, archive ? new Date() : null],
      );
      await this.audit(user, 'customer', id, archive ? '归档客户' : '恢复客户', {}, tx);
      return this.getCustomer(user, id, tx);
    });
  }
  async listFollowups(user: AuthUser, id: string, query: any) {
    await this.customerRow(user, id);
    const { page, pageSize } = pageOf(query);
    const scopeValues = [id, user.role === 'BOSS', user.id];
    const count = await this.db.query(
      'SELECT count(*)::int AS total FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.customer_id=$1 AND ($2::boolean OR c.owner_id=$3)',
      scopeValues,
    );
    const result = await this.db.query(
      "SELECT f.*,u.display_name AS actor_name FROM followups f JOIN users u ON u.id=f.actor_id JOIN customers c ON c.id=f.customer_id WHERE f.customer_id=$1 AND ($2::boolean OR c.owner_id=$3) ORDER BY (f.document->>'occurredAt') DESC,f.id LIMIT $4 OFFSET $5",
      [...scopeValues, pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((r) => ({ ...this.shape(r), actorName: r.actor_name })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async saveFollowup(user: AuthUser, id: string, input: any, followupId?: string) {
    const data = parse(followupSchema, input);
    notFuture(data.occurredAt);
    return this.write(user, undefined, async (tx) => {
      const customer = await this.customerRow(user, id, tx, true);
      if (customer.archived_at) fail('归档客户不可修改');
      if (followupId) {
        parse(uuid, followupId);
        const previous = (
          await tx.query('SELECT * FROM followups WHERE id=$1 AND customer_id=$2 FOR UPDATE', [
            followupId,
            id,
          ])
        ).rows[0];
        if (!previous) fail('跟进不存在', 404);
        checkVersion(previous.version, input);
        await tx.query(
          'UPDATE followups SET document=$2,version=version+1,updated_at=now() WHERE id=$1',
          [followupId, JSON.stringify(data)],
        );
        await this.audit(
          user,
          'followup',
          followupId,
          '修改跟进',
          { before: previous.document, after: data },
          tx,
        );
      } else {
        checkVersion(customer.version, input);
        followupId = randomUUID();
        await tx.query(
          'INSERT INTO followups(id,customer_id,actor_id,document) VALUES($1,$2,$3,$4)',
          [followupId, id, user.id, JSON.stringify(data)],
        );
        await tx.query(
          'UPDATE customers SET document=document||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1',
          [
            id,
            JSON.stringify({
              nextFollowupAt: data.nextFollowupAt,
              followupCompletedAt: new Date().toISOString(),
            }),
          ],
        );
        await this.audit(user, 'followup', followupId, '新增跟进', { customerId: id }, tx);
      }
      return { id: followupId, ...data, customer: await this.getCustomer(user, id, tx) };
    });
  }
  async completeFollowup(user: AuthUser, id: string, input: any) {
    const nextFollowupAt = parse(timestamp, input.nextFollowupAt);
    return this.write(user, undefined, async (tx) => {
      const row = await this.customerRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (row.archived_at) fail('归档客户不可修改');
      await tx.query(
        'UPDATE customers SET document=document||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1',
        [id, JSON.stringify({ nextFollowupAt, followupCompletedAt: new Date().toISOString() })],
      );
      await this.audit(user, 'customer', id, '完成待办', { nextFollowupAt }, tx);
      return this.getCustomer(user, id, tx);
    });
  }
  async productRow(id: string, tx?: PoolClient, lock = false) {
    parse(uuid, id);
    const row = (
      await this.db.query(
        `SELECT * FROM products WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
        tx,
      )
    ).rows[0];
    if (!row) fail('产品不存在', 404, 'NOT_FOUND');
    return row;
  }
  async getProduct(user: AuthUser, id: string, tx?: PoolClient) {
    const row = await this.productRow(id, tx);
    const data = this.shape(row);
    const tags = await this.db.query(
      'SELECT id,name,archived_at FROM dictionaries WHERE id=ANY($1::uuid[])',
      [data.tagIds ?? []],
      tx,
    );
    const category = data.categoryId
      ? (await this.db.query('SELECT name FROM dictionaries WHERE id=$1', [data.categoryId], tx))
          .rows[0]
      : null;
    return {
      ...data,
      categoryName: category?.name ?? '',
      tags: tags.rows.map((r) => ({ id: r.id, name: r.name, archivedAt: r.archived_at })),
    };
  }
  async listProducts(user: AuthUser, query: any = {}, tx?: PoolClient) {
    const params: any[] = [];
    const add = (value: any) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [
      query.archived === 'true' ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL',
    ];
    if (query.q) {
      const q = add(`%${String(query.q).slice(0, 200)}%`);
      where.push(
        `(p.sku ILIKE ${q} OR p.document->>'name' ILIKE ${q} OR p.document->>'model' ILIKE ${q})`,
      );
    }
    if (query.categoryId)
      where.push(`p.document->>'categoryId'=${add(parse(uuid, query.categoryId))}`);
    if (query.tagId) where.push(`p.document->'tagIds' ? ${add(parse(uuid, query.tagId))}`);
    const sql = where.join(' AND ');
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM products p WHERE ${sql}`,
      params,
      tx,
    );
    const { page, pageSize } = pageOf(query);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await this.db.query(
      `SELECT p.*,d.name AS category_name FROM products p LEFT JOIN dictionaries d ON d.id::text=p.document->>'categoryId' WHERE ${sql} ORDER BY p.updated_at DESC,p.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
      tx,
    );
    const tagIds = [...new Set(result.rows.flatMap((row) => row.document.tagIds ?? []))];
    const tags = tagIds.length
      ? (
          await this.db.query(
            'SELECT id,name,archived_at AS "archivedAt" FROM dictionaries WHERE id=ANY($1::uuid[])',
            [tagIds],
            tx,
          )
        ).rows
      : [];
    const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
    return {
      items: result.rows.map((r) => ({
        ...this.shape(r),
        categoryName: r.category_name ?? '',
        tags: (r.document.tagIds ?? []).map((id: string) => tagMap.get(id)).filter(Boolean),
      })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async createProduct(user: AuthUser, input: any, tx?: PoolClient) {
    const data = parse(productSchema, input);
    return this.write(user, tx, async (client) => {
      await this.references(data, null, client, 'product-category');
      const id = randomUUID();
      const document = { ...data, priceExTax: amount(cents(data.priceExTax)) };
      await client.query('INSERT INTO products(id,sku,document) VALUES($1,$2,$3)', [
        id,
        data.sku,
        JSON.stringify(document),
      ]);
      await this.audit(user, 'product', id, '创建产品', { sku: data.sku }, client);
      return this.getProduct(user, id, client);
    });
  }
  async updateProduct(user: AuthUser, id: string, input: any) {
    return this.write(user, undefined, async (tx) => {
      const row = await this.productRow(id, tx, true);
      checkVersion(row.version, input);
      if (row.archived_at) fail('归档产品不可修改');
      const data = parse(productSchema, { ...row.document, ...input });
      await this.references(data, row.document, tx, 'product-category');
      await tx.query(
        'UPDATE products SET sku=$2,document=$3,version=version+1,updated_at=now() WHERE id=$1',
        [id, data.sku, JSON.stringify({ ...data, priceExTax: amount(cents(data.priceExTax)) })],
      );
      await this.audit(
        user,
        'product',
        id,
        '修改产品',
        { fields: Object.keys(input).filter((k) => k !== 'version') },
        tx,
      );
      return this.getProduct(user, id, tx);
    });
  }
  async archiveProduct(user: AuthUser, id: string, input: any, archive: boolean) {
    boss(user);
    return this.write(user, undefined, async (tx) => {
      const row = await this.productRow(id, tx, true);
      checkVersion(row.version, input);
      await tx.query(
        'UPDATE products SET archived_at=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, archive ? new Date() : null],
      );
      await this.audit(user, 'product', id, archive ? '归档产品' : '恢复产品', {}, tx);
      return this.getProduct(user, id, tx);
    });
  }
  async orderRow(user: AuthUser, id: string, tx?: PoolClient, lock = false) {
    parse(uuid, id);
    const row = (
      await this.db.query(
        `SELECT o.*,c.customer_no,c.owner_id,c.document->>'contactName' AS customer_name,c.archived_at AS customer_archived_at,u.display_name AS owner_name FROM orders o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=c.owner_id WHERE o.id=$1 AND ($2::boolean OR c.owner_id=$3)${lock ? ' FOR UPDATE OF c,o' : ''}`,
        [id, user.role === 'BOSS', user.id],
        tx,
      )
    ).rows[0];
    if (!row) fail('订单不存在', 404, 'NOT_FOUND');
    return row;
  }
  async getOrder(user: AuthUser, id: string, tx?: PoolClient) {
    return this.shape(await this.orderRow(user, id, tx));
  }
  orderFilter(user: AuthUser, query: any, includeArchived = false) {
    const params: any[] = [];
    const add = (value: any) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [
      includeArchived || query.archived === 'all'
        ? 'true'
        : query.archived === 'true'
          ? 'c.archived_at IS NOT NULL'
          : 'c.archived_at IS NULL',
    ];
    if (user.role !== 'BOSS') where.push(`c.owner_id=${add(user.id)}`);
    else if (query.ownerId) where.push(`c.owner_id=${add(parse(uuid, query.ownerId))}`);
    if (query.customerId) where.push(`o.customer_id=${add(parse(uuid, query.customerId))}`);
    if (query.status) where.push(`o.status=${add(query.status)}`);
    if (query.type) where.push(`o.type=${add(query.type)}`);
    if (query.invoiceRequired === 'true' || query.invoiceRequired === 'false')
      where.push(
        `(o.document->>'invoiceRequired')::boolean=${add(query.invoiceRequired === 'true')}`,
      );
    if (query.q) {
      const p = add(`%${String(query.q).slice(0, 200)}%`);
      where.push(
        `(o.order_no ILIKE ${p} OR o.external_order_no ILIKE ${p} OR o.document->>'recipientName' ILIKE ${p} OR o.document->>'recipientPhone' ILIKE ${p} OR EXISTS(SELECT 1 FROM jsonb_array_elements(o.document->'shipments') s WHERE s->>'trackingNo' ILIKE ${p}))`,
      );
    }
    const range = dayRange(query);
    const field =
      query.dateField === 'paidAt'
        ? 'o.paid_at'
        : query.dateField === 'createdAt'
          ? 'o.created_at'
          : 'o.order_date';
    if (range.start)
      where.push(`${field}>=${add(field === 'o.order_date' ? range.startDate : range.start)}`);
    if (range.end)
      where.push(
        field === 'o.order_date' ? `${field}<=${add(range.endDate)}` : `${field}<${add(range.end)}`,
      );
    return { params, where: where.join(' AND ') };
  }
  async listOrders(user: AuthUser, query: any = {}, tx?: PoolClient) {
    const { params, where } = this.orderFilter(user, query);
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where}`,
      params,
      tx,
    );
    const { page, pageSize } = pageOf(query);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await this.db.query(
      `WITH page AS MATERIALIZED (SELECT o.id,o.created_at FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ${where} ORDER BY o.created_at DESC,o.id LIMIT $${params.length - 1} OFFSET $${params.length}) SELECT o.*,c.customer_no,c.owner_id,c.document->>'contactName' AS customer_name,u.display_name AS owner_name FROM page JOIN orders o ON o.id=page.id JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=c.owner_id ORDER BY page.created_at DESC,page.id`,
      params,
      tx,
    );
    return {
      items: result.rows.map((r) => this.shape(r)),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
  async orderDocument(user: AuthUser, data: any, previous: any, tx: PoolClient) {
    const customer = await this.customerRow(user, data.customerId, tx, true);
    if (customer.archived_at) fail('归档客户不可创建或修改订单');
    if (!!data.externalSource !== !!data.externalOrderNo) fail('外部来源和原单号须同时填写');
    if (data.originalOrderId) {
      const original = await this.orderRow(user, data.originalOrderId, tx);
      if (data.type === '正常' || original.type !== '正常') fail('请选择正常原订单');
    }
    const products = await tx.query('SELECT * FROM products WHERE id=ANY($1::uuid[]) FOR SHARE', [
      data.lines.map((line: any) => line.productId),
    ]);
    const byId = new Map(products.rows.map((p) => [p.id, p]));
    let goods = 0n;
    const lines = data.lines.map((line: any, index: number) => {
      const product = byId.get(line.productId);
      const oldLine =
        previous?.lines?.[index]?.productId === line.productId
          ? previous.lines[index]
          : previous?.lines?.find((p: any) => p.productId === line.productId);
      if (!product || (product.archived_at && !oldLine)) fail('产品已归档或不可用');
      const subtotal = cents(line.unitPriceExTax) * BigInt(line.quantity);
      goods += subtotal;
      return {
        productId: line.productId,
        sku: oldLine?.sku ?? product.sku,
        name: oldLine?.name ?? product.document.name,
        model: line.model ?? oldLine?.model ?? product.document.model,
        unit: oldLine?.unit ?? product.document.unit,
        quantity: line.quantity,
        unitPriceExTax: amount(cents(line.unitPriceExTax)),
        lineTotal: amount(subtotal),
      };
    });
    const exTax = goods + cents(data.freightFee) + cents(data.packagingFee);
    const inclTax = exTax + cents(data.taxFee);
    const shipments = data.shipments.map((s: any) => ({ ...s, id: s.id ?? randomUUID() }));
    if (new Set(shipments.map((s: any) => s.id)).size !== shipments.length)
      fail('物流记录不能重复');
    return {
      ...data,
      freightFee: amount(cents(data.freightFee)),
      packagingFee: amount(cents(data.packagingFee)),
      taxFee: amount(cents(data.taxFee)),
      lines,
      shipments,
      goodsTotal: amount(goods),
      totalExTax: amount(exTax),
      totalInclTax: amount(inclTax),
      paymentNote: previous?.paymentNote ?? '',
    };
  }
  async createOrder(user: AuthUser, input: any, tx?: PoolClient) {
    if (input.status && input.status !== '待付款') fail('请通过付款操作登记状态');
    const data = parse(orderSchema, input);
    return this.write(user, tx, async (client) => {
      const document = await this.orderDocument(user, data, null, client);
      const id = randomUUID();
      await client.query(
        'INSERT INTO orders(id,customer_id,type,order_date,total_incl_tax,external_source,external_order_no,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          data.customerId,
          data.type,
          data.orderDate,
          document.totalInclTax,
          data.externalSource || null,
          data.externalOrderNo || null,
          JSON.stringify(document),
        ],
      );
      await this.audit(
        user,
        'order',
        id,
        '创建订单',
        { totalInclTax: document.totalInclTax, type: data.type },
        client,
      );
      return this.getOrder(user, id, client);
    });
  }
  async updateOrder(user: AuthUser, id: string, input: any) {
    if ('status' in input || 'paidAt' in input || 'paymentNote' in input)
      fail('请通过付款操作登记状态');
    return this.write(user, undefined, async (tx) => {
      const row = await this.orderRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (row.status === '取消付款') fail('取消订单不可修改');
      if (row.customer_archived_at) fail('归档客户订单不可修改');
      let document: any;
      if (row.status === '已付款') {
        const allowed = [
          'version',
          'recipientName',
          'recipientPhone',
          'recipientAddress',
          'invoiceRequired',
          'note',
          'shipments',
        ];
        if (Object.keys(input).some((k) => !allowed.includes(k)))
          fail('已付款订单金额与明细不可修改');
        const data = parse(
          orderSchema.pick({
            recipientName: true,
            recipientPhone: true,
            recipientAddress: true,
            invoiceRequired: true,
            note: true,
            shipments: true,
          }),
          { ...row.document, ...input },
        );
        document = {
          ...row.document,
          ...data,
          shipments: data.shipments.map((s) => ({ ...s, id: s.id ?? randomUUID() })),
        };
      } else {
        const data = parse(orderSchema, { ...row.document, ...input });
        if (data.originalOrderId === id) fail('原订单不能为当前订单');
        document = await this.orderDocument(user, data, row.document, tx);
      }
      await tx.query(
        'UPDATE orders SET customer_id=$2,type=$3,order_date=$4,total_incl_tax=$5,external_source=$6,external_order_no=$7,document=$8,version=version+1,updated_at=now() WHERE id=$1',
        [
          id,
          document.customerId,
          document.type,
          document.orderDate,
          document.totalInclTax,
          document.externalSource || null,
          document.externalOrderNo || null,
          JSON.stringify(document),
        ],
      );
      await this.audit(
        user,
        'order',
        id,
        '修改订单',
        {
          before: { totalInclTax: row.total_incl_tax, shipments: row.document.shipments },
          after: { totalInclTax: document.totalInclTax, shipments: document.shipments },
          fields: Object.keys(input).filter((k) => k !== 'version'),
        },
        tx,
      );
      return this.getOrder(user, id, tx);
    });
  }
  async payOrder(user: AuthUser, id: string, input: any, tx?: PoolClient) {
    const data = parse(
      z
        .object({
          version: z.number().int().positive(),
          paidAt: z.string().datetime({ offset: true }),
          paymentNote: z.string().max(2000).default(''),
        })
        .strict(),
      input,
    );
    notFuture(data.paidAt);
    return this.write(user, tx, async (client) => {
      const row = await this.orderRow(user, id, client, true);
      checkVersion(row.version, input);
      if (row.status !== '待付款')
        fail('该订单不能登记付款', row.status === '取消付款' ? 422 : 409, 'STATE_CONFLICT');
      await client.query(
        "UPDATE orders SET status='已付款',paid_at=$2,document=document||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [id, data.paidAt, JSON.stringify({ paymentNote: data.paymentNote })],
      );
      await client.query(
        'INSERT INTO payment_changes(id,order_id,actor_id,previous_status,next_status,amount,paid_at,payment_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          id,
          user.id,
          row.status,
          '已付款',
          row.total_incl_tax,
          data.paidAt,
          data.paymentNote,
        ],
      );
      if (row.type === '正常') {
        await client.query(
          "UPDATE customers SET document=document||jsonb_build_object('status','已付款','lastDealAt',GREATEST((document->>'lastDealAt')::timestamptz,$2::timestamptz)),version=version+1,updated_at=now() WHERE id=$1",
          [row.customer_id, data.paidAt],
        );
      }
      await this.audit(
        user,
        'order',
        id,
        '登记付款',
        { paidAt: data.paidAt, amount: row.total_incl_tax },
        client,
      );
      return this.getOrder(user, id, client);
    });
  }
  async cancelOrder(user: AuthUser, id: string, input: any) {
    const reason = parse(required, input.reason);
    return this.write(user, undefined, async (tx) => {
      const row = await this.orderRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (row.status !== '待付款') fail('该订单不能取消', 409, 'STATE_CONFLICT');
      await tx.query(
        "UPDATE orders SET status='取消付款',document=document||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [id, JSON.stringify({ cancelReason: reason })],
      );
      await tx.query(
        'INSERT INTO payment_changes(id,order_id,actor_id,previous_status,next_status,amount,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), id, user.id, row.status, '取消付款', row.total_incl_tax, reason],
      );
      await this.audit(user, 'order', id, '取消订单', { reason }, tx);
      return this.getOrder(user, id, tx);
    });
  }
  async correctPayment(user: AuthUser, id: string, input: any) {
    boss(user);
    const data = parse(
      z.object({
        status: z.enum(['待付款', '已付款']),
        paidAt: timestamp,
        paymentNote: z.string().max(2000).default(''),
        reason: required,
      }),
      input,
    );
    notFuture(data.paidAt);
    if (data.status === '已付款' && !data.paidAt) fail('请填写付款时间');
    return this.write(user, undefined, async (tx) => {
      const row = await this.orderRow(user, id, tx, true);
      checkVersion(row.version, input);
      if (row.status !== '已付款') fail('该订单没有可更正的付款', 409, 'STATE_CONFLICT');
      if (row.customer_archived_at && data.status === '待付款') fail('请先恢复客户');
      const paidAt = data.status === '已付款' ? data.paidAt : null;
      await tx.query(
        'UPDATE orders SET status=$2,paid_at=$3,document=document||$4::jsonb,version=version+1,updated_at=now() WHERE id=$1',
        [id, data.status, paidAt, JSON.stringify({ paymentNote: data.paymentNote })],
      );
      await tx.query(
        'INSERT INTO payment_changes(id,order_id,actor_id,previous_status,next_status,amount,paid_at,payment_note,reason,previous_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          randomUUID(),
          id,
          user.id,
          row.status,
          data.status,
          row.total_incl_tax,
          paidAt,
          data.paymentNote,
          data.reason,
          JSON.stringify({ paidAt: row.paid_at, paymentNote: row.document.paymentNote }),
        ],
      );
      await this.audit(
        user,
        'order',
        id,
        '更正付款',
        {
          before: {
            status: row.status,
            paidAt: row.paid_at,
            paymentNote: row.document.paymentNote,
          },
          after: data,
        },
        tx,
      );
      return this.getOrder(user, id, tx);
    });
  }
  async listPayments(user: AuthUser, id: string) {
    await this.orderRow(user, id);
    const result = await this.db.query(
      'SELECT p.*,u.display_name AS actor_name FROM payment_changes p JOIN users u ON u.id=p.actor_id JOIN orders o ON o.id=p.order_id JOIN customers c ON c.id=o.customer_id WHERE p.order_id=$1 AND ($2::boolean OR c.owner_id=$3) ORDER BY p.created_at DESC,p.id',
      [id, user.role === 'BOSS', user.id],
    );
    return result.rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      previousStatus: r.previous_status,
      nextStatus: r.next_status,
      amount: r.amount,
      paidAt: r.paid_at,
      paymentNote: r.payment_note,
      reason: r.reason,
      previousValue: r.previous_value,
      createdAt: r.created_at,
    }));
  }
  async saveShipment(user: AuthUser, id: string, input: any, shipmentId?: string) {
    const order = await this.getOrder(user, id);
    checkVersion(order.version, input);
    const data = parse(shipmentSchema, input);
    const shipments = [...order.shipments];
    if (shipmentId) {
      const index = shipments.findIndex((s: any) => s.id === shipmentId);
      if (index === -1) fail('物流记录不存在', 404);
      shipments[index] = { ...data, id: shipmentId };
    } else shipments.push({ ...data, id: randomUUID() });
    return this.updateOrder(user, id, { version: order.version, shipments });
  }
  async dashboard(user: AuthUser, query: any) {
    const range = dayRange(query, true);
    const scope =
      user.role === 'BOSS' ? (query.ownerId ? parse(uuid, query.ownerId) : null) : user.id;
    const params = [scope, range.start, range.end, range.startDate, range.endDate];
    const customers = await this.db.query(
      "SELECT count(*)::int AS customer_count,count(*) FILTER(WHERE followup_status IN ('待跟进','已报价','待付款'))::int AS pending_customer_count,count(*) FILTER(WHERE next_followup_at<((date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 day') AT TIME ZONE 'Asia/Shanghai'))::int AS today_followup_count,count(*) FILTER(WHERE next_followup_at<(date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))::int AS overdue_followup_count,count(*) FILTER(WHERE followup_status='已付款' AND last_deal_at>=$2 AND last_deal_at<$3)::int AS recent_deal_customer_count FROM customers WHERE archived_at IS NULL AND ($1::uuid IS NULL OR owner_id=$1)",
      params.slice(0, 3),
    );
    const orders = await this.db.query(
      "SELECT coalesce(sum(o.total_incl_tax) FILTER(WHERE o.type='正常' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3),0)::text AS deal_amount,count(*) FILTER(WHERE o.type='正常' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3)::int AS deal_order_count,coalesce(sum(o.total_incl_tax) FILTER(WHERE o.type='正常' AND o.status='待付款' AND o.order_date>=$4::date AND o.order_date<=$5::date),0)::text AS pending_amount,count(*) FILTER(WHERE o.type='退货' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3)::int AS return_count,coalesce(sum(o.total_incl_tax) FILTER(WHERE o.type='退货' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3),0)::text AS return_amount,count(*) FILTER(WHERE o.type='维修' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3)::int AS repair_count,coalesce(sum(o.total_incl_tax) FILTER(WHERE o.type='维修' AND o.status='已付款' AND o.paid_at>=$2 AND o.paid_at<$3),0)::text AS repair_amount FROM orders o JOIN customers c ON c.id=o.customer_id WHERE ($1::uuid IS NULL OR c.owner_id=$1)",
      params,
    );
    const c = customers.rows[0];
    const o = orders.rows[0];
    return {
      customerCount: c.customer_count,
      pendingCustomerCount: c.pending_customer_count,
      todayFollowupCount: c.today_followup_count,
      overdueFollowupCount: c.overdue_followup_count,
      recentDealCustomerCount: c.recent_deal_customer_count,
      dealAmount: formatAmount(cents(o.deal_amount)),
      dealOrderCount: o.deal_order_count,
      pendingAmount: formatAmount(cents(o.pending_amount)),
      returnCount: o.return_count,
      returnAmount: formatAmount(cents(o.return_amount)),
      repairCount: o.repair_count,
      repairAmount: formatAmount(cents(o.repair_amount)),
    };
  }
  async trends(user: AuthUser, query: any) {
    const range = dayRange(query, true);
    const scope =
      user.role === 'BOSS' ? (query.ownerId ? parse(uuid, query.ownerId) : null) : user.id;
    const result = await this.db.query(
      "SELECT to_char(d.day,'YYYY-MM-DD') AS date,coalesce(x.amount,0)::text AS amount,coalesce(x.count,0)::int AS count FROM generate_series($2::date,$3::date,interval '1 day') d(day) LEFT JOIN (SELECT (o.paid_at AT TIME ZONE 'Asia/Shanghai')::date AS date,sum(o.total_incl_tax) AS amount,count(*)::int AS count FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.status='已付款' AND o.type='正常' AND ($1::uuid IS NULL OR c.owner_id=$1) AND o.paid_at>=$4::timestamptz AND o.paid_at<$5::timestamptz GROUP BY 1) x ON x.date=d.day::date ORDER BY d.day",
      [scope, range.startDate, range.endDate, range.start, range.end],
    );
    return result.rows;
  }
  async auditEvents(user: AuthUser, query: any) {
    boss(user);
    const { page, pageSize } = pageOf(query);
    const values: any[] = [];
    const where = ['true'];
    if (query.entityType) {
      values.push(query.entityType);
      where.push(`a.entity_type=$${values.length}`);
    }
    if (query.actorId) {
      values.push(parse(uuid, query.actorId));
      where.push(`a.actor_id=$${values.length}`);
    }
    if (query.operation) {
      values.push(query.operation);
      where.push(`a.operation=$${values.length}`);
    }
    const range = dayRange(query);
    if (range.start) {
      values.push(range.start);
      where.push(`a.created_at>=$${values.length}`);
    }
    if (range.end) {
      values.push(range.end);
      where.push(`a.created_at<$${values.length}`);
    }
    if (query.q) {
      values.push(`%${String(query.q).slice(0, 200)}%`);
      where.push(
        `(a.operation ILIKE $${values.length} OR u.display_name ILIKE $${values.length} OR a.entity_id::text ILIKE $${values.length})`,
      );
    }
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where.join(' AND ')}`,
      values,
    );
    values.push(pageSize, (page - 1) * pageSize);
    const result = await this.db.query(
      `SELECT a.*,u.display_name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC,a.id LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      items: result.rows.map((r) => ({
        id: r.id,
        actorName: r.actor_name,
        entityType: r.entity_type,
        entityId: r.entity_id,
        operation: r.operation,
        changes: r.changes,
        createdAt: r.created_at,
      })),
      total: count.rows[0].total,
      page,
      pageSize,
    };
  }
}
