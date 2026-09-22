import { Inject, Injectable, HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { AuthService, type AuthUser } from '../auth.service';
import { CoreService } from '../core.service';
import { DatabaseService } from '../database.service';
import { amount, cents, money, parse, productSchema } from '../validation';
import {
  importColumns,
  type SpreadsheetRow,
  type TransferError,
  type TransferKind,
} from './transfer.types';

type Reference = { table: string; id: string; version: number };
type PreparedRow = { row: number; input: Record<string, unknown> };
type Preview = {
  errors: TransferError[];
  duplicates: TransferError[];
  validRows: number;
  expectedNew: number;
  references: Reference[];
};

class PreviewRollback extends Error {
  constructor(readonly preview: Preview) {
    super('PREVIEW_ROLLBACK');
  }
}

function split(value = '') {
  return [
    ...new Set(
      value
        .split(/[;；]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
function rejectField(field: string, message: string): never {
  throw new HttpException({ message, fieldErrors: { [field]: [message] } }, 422);
}
function errorFields(error: unknown, row: number, kind: TransferKind): TransferError[] {
  const response = error instanceof HttpException ? error.getResponse() : null;
  if (response && typeof response === 'object') {
    const value = response as { message?: string; fieldErrors?: Record<string, string | string[]> };
    if (value.fieldErrors && Object.keys(value.fieldErrors).length)
      return Object.entries(value.fieldErrors).map(([field, messages]) => ({
        row,
        field: importColumns[kind][field] || field,
        message: Array.isArray(messages) ? messages.join('，') : String(messages),
      }));
    return [{ row, field: '数据', message: value.message || '数据校验失败' }];
  }
  const errorCode = (error as { code?: string })?.code;
  return [
    {
      row,
      field: '数据',
      message:
        errorCode === '23505'
          ? kind === 'orders'
            ? '该记录无法导入'
            : '记录重复，请检查后重试'
          : '数据校验失败',
    },
  ];
}

@Injectable()
export class TransferDataService {
  private readonly referenceCaches = new WeakMap<Reference[], Map<string, string>>();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CoreService) private readonly core: CoreService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async reference(
    table: string,
    field: string,
    value: string,
    user: AuthUser,
    tx: PoolClient,
    references: Reference[],
    dictionaryKind?: string,
  ) {
    const allowed = [
      'products',
      'customers',
      'orders',
      'users',
      'dictionaries',
      'merchant_accounts',
    ];
    if (
      !allowed.includes(table) ||
      !['sku', 'customer_no', 'order_no', 'login_name', 'name'].includes(field)
    )
      throw new Error('INVALID_REFERENCE');
    const cache = this.referenceCaches.get(references) || new Map<string, string>();
    this.referenceCaches.set(references, cache);
    const cacheKey = `${table}:${field}:${value}:${dictionaryKind || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const parameters: unknown[] = [value];
    let condition = `${field}=$1`;
    if (table === 'customers' && user.role !== 'BOSS') {
      parameters.push(user.id);
      condition += ` AND owner_id=$${parameters.length}`;
    }
    if (table === 'orders' && user.role !== 'BOSS') {
      parameters.push(user.id);
      condition += ` AND customer_id IN (SELECT id FROM customers WHERE owner_id=$${parameters.length})`;
    }
    if (['products', 'customers', 'dictionaries'].includes(table))
      condition += ' AND archived_at IS NULL';
    if (table === 'users') condition += " AND account_status='ACTIVE'";
    if (table === 'merchant_accounts') condition += ' AND enabled=true';
    if (dictionaryKind) {
      parameters.push(dictionaryKind);
      condition += ` AND kind=$${parameters.length}`;
    }
    const { rows } = await this.db.query(
      `SELECT id,version FROM ${table} WHERE ${condition} FOR SHARE`,
      parameters,
      tx,
    );
    if (rows.length !== 1) rejectField(field, '关联记录不存在、已停用或不可访问');
    references.push({ table, id: rows[0].id, version: rows[0].version });
    cache.set(cacheKey, rows[0].id);
    return rows[0].id as string;
  }

  async prepare(
    kind: TransferKind,
    rows: SpreadsheetRow[],
    user: AuthUser,
    tx: PoolClient,
    references: Reference[],
    errors: TransferError[],
  ) {
    const prepared: PreparedRow[] = [];
    const groups = new Map<string, SpreadsheetRow[]>();
    if (kind === 'orders')
      for (const row of rows) {
        const key = row.values.group;
        if (!key) {
          errors.push({ row: row.row, field: '订单分组', message: '请填写订单分组' });
          continue;
        }
        groups.set(key, [...(groups.get(key) || []), row]);
      }
    const sourceGroups = kind === 'orders' ? [...groups.values()] : rows.map((row) => [row]);
    for (const group of sourceGroups) {
      const { row, values: value } = group[0];
      let errorRow = row;
      try {
        let input: Record<string, unknown>;
        if (kind === 'customers') {
          if (
            user.role !== 'BOSS' &&
            value.ownerLoginName &&
            value.ownerLoginName !== user.loginName
          )
            rejectField('ownerLoginName', '不能指定其他负责人');
          const ownerId = value.ownerLoginName
            ? await this.reference(
                'users',
                'login_name',
                value.ownerLoginName,
                user,
                tx,
                references,
              )
            : user.id;
          if (user.role !== 'BOSS' && ownerId !== user.id)
            rejectField('ownerLoginName', '不能指定其他负责人');
          input = {
            companyName: value.companyName,
            contactName: value.contactName,
            contactPhone: value.contactPhone,
            deliveryAddress: value.deliveryAddress || '',
            taxId: value.companyTaxId,
            companyPhone: value.companyPhone,
            companyAddress: value.companyAddress,
            bankName: value.bankName,
            bankAccount: value.bankAccount,
            taobaoId: value.taobaoId,
            wechatId: value.wechatId,
            wechatName: value.wechatName,
            douyinId: value.douyinId,
            sourceChannel: value.sourceChannel,
            status: value.followupStatus || '待跟进',
            ownerId,
            lastDealAt: value.lastDealAt || null,
            nextFollowupAt: value.nextFollowupAt || null,
            merchantAccountId: await this.reference(
              'merchant_accounts',
              'name',
              value.merchantAccountNames,
              user,
              tx,
              references,
            ),
            productIds: await Promise.all(
              split(value.productSkus).map((sku) =>
                this.reference('products', 'sku', sku, user, tx, references),
              ),
            ),
            tagIds: await Promise.all(
              split(value.tags).map((name) =>
                this.reference('dictionaries', 'name', name, user, tx, references, 'customer-tag'),
              ),
            ),
          };
        } else if (kind === 'products') {
          input = {
            sku: value.sku,
            name: value.name,
            model: value.model,
            unit: value.unit || '件',
            priceExTax: value.priceExTax,
            categoryId: value.category
              ? await this.reference(
                  'dictionaries',
                  'name',
                  value.category,
                  user,
                  tx,
                  references,
                  'product-category',
                )
              : null,
            tagIds: await Promise.all(
              split(value.tags).map((name) =>
                this.reference('dictionaries', 'name', name, user, tx, references, 'product-tag'),
              ),
            ),
            assetIds: [],
          };
        } else {
          const common = Object.keys(importColumns.orders).filter(
            (key) => !['productSku', 'quantity', 'unitPriceExTax'].includes(key),
          );
          for (const item of group)
            for (const key of common)
              if (item.values[key] !== value[key]) {
                errorRow = item.row;
                rejectField(key, '同一订单分组的订单字段必须一致');
              }
          const lines = [];
          for (const item of group) {
            errorRow = item.row;
            if (!/^[1-9]\d{0,5}$/.test(item.values.quantity))
              rejectField('quantity', '数量须为 1 至 999999 的整数');
            if (!money.safeParse(item.values.unitPriceExTax).success)
              rejectField('unitPriceExTax', '金额格式错误');
            lines.push({
              productId: await this.reference(
                'products',
                'sku',
                item.values.productSku,
                user,
                tx,
                references,
              ),
              quantity: Number(item.values.quantity),
              unitPriceExTax: item.values.unitPriceExTax,
            });
          }
          errorRow = row;
          input = {
            customerId: await this.reference(
              'customers',
              'customer_no',
              value.customerNo,
              user,
              tx,
              references,
            ),
            orderDate: value.orderDate.includes('T')
              ? value.orderDate.slice(0, 10)
              : value.orderDate,
            recipientName: value.recipientName,
            recipientPhone: value.recipientPhone,
            recipientAddress: value.recipientAddress,
            invoiceRequired: value.invoiceRequired === '是',
            type: value.type || '正常',
            externalSource: value.externalSource,
            externalOrderNo: value.externalOrderNo,
            originalOrderId: value.originalOrderNo
              ? await this.reference(
                  'orders',
                  'order_no',
                  value.originalOrderNo,
                  user,
                  tx,
                  references,
                )
              : null,
            freightFee: value.freight || '0',
            packagingFee: value.packaging || '0',
            taxFee: value.tax || '0',
            taxRate: value.taxRate || '0',
            taxFeeMode: value.taxFeeMode === '自动计算' ? 'auto' : 'manual',
            totalInclTaxOverride: value.totalInclTaxOverride || null,
            note: value.note,
            lines,
            shipments:
              value.carrier || value.trackingNo
                ? [
                    {
                      carrier: value.carrier,
                      freightPayment: value.freightPayment || '现付',
                      trackingNo: value.trackingNo,
                    },
                  ]
                : [],
            status: value.status || '待付款',
            paidAt: value.paidAt || null,
            paymentNote: value.paymentNote,
            receivingAccount: value.receivingAccount,
          };
        }
        prepared.push({ row, input });
      } catch (error) {
        errors.push(...errorFields(error, errorRow, kind));
      }
    }
    return prepared;
  }

  async preview(kind: TransferKind, rows: SpreadsheetRow[], actorId: string): Promise<Preview> {
    try {
      await this.db.transaction(async (tx) => {
        const user = await this.auth.getActiveUser(actorId, tx);
        if (user.mustChangePassword) throw new HttpException('请先修改密码', 403);
        const errors: TransferError[] = [];
        const duplicates: TransferError[] = [];
        const references: Reference[] = [];
        const prepared = await this.prepare(kind, rows, user, tx, references, errors);
        let expectedNew = 0;
        if (kind === 'products')
          expectedNew = (await this.validateProducts(prepared, tx, errors)).length;
        for (const item of kind === 'products' ? [] : prepared) {
          await tx.query('SAVEPOINT transfer_row');
          try {
            if (
              kind === 'customers' &&
              !item.input.taobaoId &&
              !item.input.wechatId &&
              !item.input.douyinId
            ) {
              const matches = await tx.query(
                "SELECT id FROM customers WHERE document->>'contactName'=$1 AND coalesce(document->>'companyName','')=$2 AND ($3::boolean OR owner_id=$4) LIMIT 1",
                [
                  item.input.contactName,
                  item.input.companyName || '',
                  user.role === 'BOSS',
                  user.id,
                ],
              );
              if (matches.rowCount)
                duplicates.push({
                  row: item.row,
                  field: '联系人',
                  message: '存在同名联系人，请核对',
                });
            }
            await this.create(kind, user, item.input, tx);
            expectedNew += 1;
            await tx.query('RELEASE SAVEPOINT transfer_row');
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT transfer_row');
            errors.push(...errorFields(error, item.row, kind));
          }
        }
        const invalidGroups = new Set(
          rows
            .filter((row) => errors.some((error) => error.row === row.row))
            .map((row) => row.values.group),
        );
        const validRows = rows.filter((row) =>
          kind === 'orders'
            ? !invalidGroups.has(row.values.group)
            : !errors.some((error) => error.row === row.row),
        ).length;
        throw new PreviewRollback({
          errors,
          duplicates,
          validRows,
          expectedNew,
          references: [
            ...new Map(
              references.map((reference) => [`${reference.table}:${reference.id}`, reference]),
            ).values(),
          ],
        });
      });
    } catch (error) {
      if (error instanceof PreviewRollback) return error.preview;
      throw error;
    }
    throw new Error('PREVIEW_TRANSACTION_FAILED');
  }

  async commit(
    kind: TransferKind,
    rows: SpreadsheetRow[],
    actorId: string,
    references: Reference[],
    tx: PoolClient,
  ) {
    const user = await this.auth.getActiveUser(actorId, tx);
    if (user.mustChangePassword) throw new HttpException('请先修改密码', 403);
    for (const reference of references) {
      if (
        !['products', 'customers', 'orders', 'users', 'dictionaries', 'merchant_accounts'].includes(
          reference.table,
        )
      )
        throw new Error('INVALID_REFERENCE');
      const current = await tx.query(
        `SELECT version FROM ${reference.table} WHERE id=$1 FOR SHARE`,
        [reference.id],
      );
      if (!current.rows[0] || current.rows[0].version !== reference.version)
        throw new HttpException('关联数据已更新，请重新预检', 409);
    }
    const errors: TransferError[] = [];
    const prepared = await this.prepare(kind, rows, user, tx, [], errors);
    if (errors.length) throw new HttpException({ message: '数据校验失败', errors }, 422);
    if (kind === 'products') {
      const products = await this.validateProducts(prepared, tx, errors);
      if (errors.length) throw new HttpException({ message: '数据校验失败', errors }, 422);
      const records = JSON.stringify(products.map(({ row, ...product }) => product));
      await tx.query(
        'INSERT INTO products(id,sku,document) SELECT id,sku,document FROM jsonb_to_recordset($1::jsonb) AS record(id uuid,sku text,document jsonb)',
        [records],
      );
      await tx.query(
        "INSERT INTO audit_events(id,actor_id,entity_type,entity_id,operation,changes) SELECT gen_random_uuid(),$2::uuid,'product',id,'创建产品',jsonb_build_object('sku',sku) FROM jsonb_to_recordset($1::jsonb) AS record(id uuid,sku text)",
        [records, user.id],
      );
      return { createdCount: products.length, resourceIds: products.map((product) => product.id) };
    }
    const resourceIds: string[] = [];
    for (const item of prepared) {
      try {
        resourceIds.push((await this.create(kind, user, item.input, tx)).id);
      } catch (error) {
        throw new HttpException(
          { message: '数据校验失败', errors: errorFields(error, item.row, kind) },
          422,
        );
      }
    }
    return { createdCount: resourceIds.length, resourceIds };
  }

  async validateProducts(prepared: PreparedRow[], tx: PoolClient, errors: TransferError[]) {
    const products: Array<{
      id: string;
      row: number;
      sku: string;
      document: Record<string, unknown>;
    }> = [];
    const skus = new Set<string>();
    const validatedReferences = new Set<string>();
    for (const item of prepared) {
      try {
        const data = parse(productSchema, item.input);
        if (skus.has(data.sku)) rejectField('sku', '产品编号重复');
        const key = JSON.stringify({
          categoryId: data.categoryId,
          tagIds: data.tagIds,
          assetIds: data.assetIds,
        });
        if (!validatedReferences.has(key)) {
          await this.core.references(data, null, tx, 'product-category');
          validatedReferences.add(key);
        }
        products.push({
          id: randomUUID(),
          row: item.row,
          sku: data.sku,
          document: { ...data, priceExTax: amount(cents(data.priceExTax)) },
        });
        skus.add(data.sku);
      } catch (error) {
        errors.push(...errorFields(error, item.row, 'products'));
      }
    }
    const existing = await tx.query('SELECT sku FROM products WHERE sku=ANY($1::text[])', [
      products.map((product) => product.sku),
    ]);
    const existingSkus = new Set(existing.rows.map((row) => row.sku));
    for (const product of products)
      if (existingSkus.has(product.sku))
        errors.push({ row: product.row, field: '产品编号', message: '产品编号重复' });
    return products.filter((product) => !existingSkus.has(product.sku));
  }

  async create(
    kind: TransferKind,
    user: AuthUser,
    input: Record<string, unknown>,
    tx: PoolClient,
  ): Promise<any> {
    if (kind === 'customers') return this.core.createCustomer(user, input, tx);
    if (kind === 'products') return this.core.createProduct(user, input, tx);
    const { status, paidAt, paymentNote, receivingAccount, ...orderInput } = input;
    const order = await this.core.createOrder(user, orderInput, tx);
    if (status === '已付款')
      return this.core.payOrder(
        user,
        order.id,
        { version: order.version, paidAt, paymentNote: paymentNote || '', receivingAccount },
        tx,
      );
    return order;
  }

  async assertScope(user: AuthUser, kind: TransferKind, ids: string[], tx?: PoolClient) {
    if (!ids.length) return;
    if (kind === 'products') {
      const result = await this.db.query(
        'SELECT count(*)::int AS count FROM products WHERE id=ANY($1::uuid[])',
        [ids],
        tx,
      );
      if (result.rows[0].count !== ids.length)
        throw new HttpException('文件已失效，请重新导出', 403);
    } else {
      const query =
        kind === 'customers'
          ? 'SELECT count(*)::int AS count FROM customers WHERE id=ANY($1::uuid[]) AND ($2::boolean OR owner_id=$3)'
          : 'SELECT count(*)::int AS count FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=ANY($1::uuid[]) AND ($2::boolean OR c.owner_id=$3)';
      const result = await this.db.query(query, [ids, user.role === 'BOSS', user.id], tx);
      if (result.rows[0].count !== ids.length)
        throw new HttpException('文件已失效，请重新导出', 403);
    }
  }

  async exportRows(user: AuthUser, kind: TransferKind, filters: Record<string, unknown>) {
    return this.db.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const resources: any[] = [];
      for (let page = 1; ; page += 1) {
        const query = { ...filters, page, pageSize: 100 };
        const result =
          kind === 'customers'
            ? await this.core.listCustomers(user, query, tx)
            : kind === 'products'
              ? await this.core.listProducts(user, query, tx)
              : await this.core.listOrders(user, query, tx);
        resources.push(...result.items);
        if (resources.length >= result.total || !result.items.length) break;
      }
      const ownerIds = [...new Set(resources.map((resource) => resource.ownerId).filter(Boolean))];
      const owners =
        kind === 'customers' && ownerIds.length
          ? (await tx.query('SELECT id,login_name FROM users WHERE id=ANY($1::uuid[])', [ownerIds]))
              .rows
          : [];
      const originalIds = [
        ...new Set(resources.map((resource) => resource.originalOrderId).filter(Boolean)),
      ];
      const originals =
        kind === 'orders' && originalIds.length
          ? (
              await tx.query('SELECT id,order_no FROM orders WHERE id=ANY($1::uuid[])', [
                originalIds,
              ])
            ).rows
          : [];
      const rows: Record<string, unknown>[] = [];
      for (const resource of resources) {
        if (kind === 'customers')
          rows.push({
            ...resource,
            companyTaxId: resource.taxId,
            followupStatus: resource.status,
            merchantAccountNames: resource.merchantAccountName,
            productSkus: (resource.products || []).map((product: any) => product.sku).join(';'),
            tags: (resource.tags || []).map((tag: any) => tag.name).join(';'),
            ownerLoginName: owners.find((owner) => owner.id === resource.ownerId)?.login_name || '',
          });
        else if (kind === 'products')
          rows.push({
            ...resource,
            category: resource.categoryName,
            tags: (resource.tags || []).map((tag: any) => tag.name).join(';'),
          });
        else
          for (const line of resource.lines || [])
            rows.push({
              ...resource,
              group: resource.orderNo,
              productSku: line.sku,
              quantity: line.quantity,
              unitPriceExTax: line.unitPriceExTax,
              originalOrderNo:
                originals.find((original) => original.id === resource.originalOrderId)?.order_no ||
                '',
              invoiceRequired: resource.invoiceRequired ? '是' : '否',
              freight: resource.freightFee,
              packaging: resource.packagingFee,
              tax: resource.taxFee,
              taxFeeMode: resource.taxFeeMode === 'auto' ? '自动计算' : '手动金额',
              carrier: (resource.shipments || []).map((item: any) => item.carrier).join(';'),
              freightPayment: (resource.shipments || [])
                .map((item: any) => item.freightPayment)
                .join(';'),
              trackingNo: (resource.shipments || []).map((item: any) => item.trackingNo).join(';'),
            });
      }
      const columns = {
        ...importColumns[kind],
        ...(kind === 'customers'
          ? { customerNo: '客户编号', ownerName: '负责人' }
          : kind === 'orders'
            ? {
                orderNo: '订单编号',
                status: '订单状态',
                paidAt: '付款时间',
                totalExTax: '不含税总计',
                totalInclTax: '含税总计',
              }
            : {}),
      };
      return {
        rows,
        columns: Object.entries(columns).map(([key, header]) => ({ key, header })),
        resourceIds: resources.map((resource) => resource.id),
      };
    });
  }
}
