import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { AuthService, type AuthUser } from '../apps/api/src/auth.service';
import { CoreService } from '../apps/api/src/core.service';
import { DatabaseService } from '../apps/api/src/database.service';

const schema = `refinement_migration_${randomUUID().replaceAll('-', '')}`;
const ownerId = randomUUID();
const merchantId = randomUUID();
const customerId = randomUUID();
const productId = randomUUID();
const unpaidOrderId = randomUUID();
const paidOrderId = randomUUID();
const paymentId = randomUUID();
const attachmentId = randomUUID();
const paidAt = '2026-09-01T02:00:00.000Z';
const companyAddress = '广州市旧版客户公司地址 12 号';
const owner: AuthUser = {
  id: ownerId,
  loginName: 'migration-owner',
  displayName: '升级验收老板',
  role: 'BOSS',
  accountStatus: 'ACTIVE',
  mustChangePassword: false,
  version: 1,
};
let database: DatabaseService;
let core: CoreService;
let schemaCreated = false;
let legacyRows: Awaited<ReturnType<typeof snapshotLegacyRows>>;

function oldOrderDocument(unitPrice: string, taxFee: string, freightFee: string) {
  const goodsTotal = unitPrice === '100.00' ? '200.00' : '80.00';
  return {
    customerId,
    orderDate: '2026-09-01',
    type: '正常',
    recipientName: '旧版客户',
    recipientPhone: '13800000000',
    recipientAddress: companyAddress,
    invoiceRequired: false,
    note: '升级前备注',
    freightFee,
    packagingFee: '2.00',
    taxFee,
    goodsTotal,
    totalExTax: goodsTotal === '200.00' ? '212.00' : '83.00',
    totalInclTax: goodsTotal === '200.00' ? '219.77' : '88.66',
    paymentNote: goodsTotal === '200.00' ? '' : '旧版人工登记付款',
    lines: [
      {
        productId,
        sku: 'MIGRATION-PRODUCT',
        name: '旧版验收产品',
        model: '',
        unit: '件',
        quantity: 2,
        unitPriceExTax: unitPrice,
        lineTotal: goodsTotal,
      },
    ],
    shipments: [],
  };
}

async function snapshotLegacyRows() {
  return {
    customers: (await database.query('SELECT * FROM customers ORDER BY id')).rows,
    orders: (await database.query('SELECT * FROM orders ORDER BY id')).rows,
    payments: (await database.query('SELECT * FROM payment_changes ORDER BY id')).rows,
  };
}

async function snapshotAllRows() {
  return {
    ...(await snapshotLegacyRows()),
    drafts: (await database.query('SELECT * FROM customer_drafts ORDER BY user_id')).rows,
    attachments: (await database.query('SELECT * FROM waybill_attachments ORDER BY id')).rows,
    migrations: (await database.query('SELECT * FROM schema_migrations ORDER BY name')).rows,
    audit: (await database.query('SELECT * FROM audit_events ORDER BY id')).rows,
  };
}

beforeAll(async () => {
  if (!process.env.BOS_TEST_DB_PASSWORD) throw new Error('TEST_DATABASE_PASSWORD_REQUIRED');
  vi.stubEnv('PGHOST', '127.0.0.1');
  vi.stubEnv('PGPORT', '54322');
  vi.stubEnv('PGDATABASE', 'business_test');
  vi.stubEnv('PGUSER', 'business_test');
  vi.stubEnv('PGPASSWORD', process.env.BOS_TEST_DB_PASSWORD);
  vi.stubEnv('PGSSLMODE', 'disable');
  vi.stubEnv('PGOPTIONS', `-c search_path=${schema}`);
  vi.stubEnv('BOS_ROOT', fileURLToPath(new URL('../', import.meta.url)));
  database = new DatabaseService();
  expect((await database.query('SELECT current_database() AS name')).rows[0].name).toBe(
    'business_test',
  );
  if (!/^refinement_migration_[a-f0-9]{32}$/.test(schema)) throw new Error('INVALID_TEST_SCHEMA');
  await database.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  expect((await database.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
  await database.transaction(async (tx) => {
    await tx.query(
      'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of ['0001.sql', '0002.sql', '0003.sql']) {
      await tx.query(
        await readFile(new URL(`../packages/database/migrations/${name}`, import.meta.url), 'utf8'),
      );
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
    await tx.query(
      'INSERT INTO users(id,login_name,display_name,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,$5,false)',
      [ownerId, owner.loginName, owner.displayName, 'migration-fixture-hash', owner.role],
    );
    await tx.query('INSERT INTO merchant_accounts(id,name,platform) VALUES($1,$2,$3)', [
      merchantId,
      '旧版验收商家',
      '微信',
    ]);
    await tx.query(
      'INSERT INTO customers(id,owner_id,merchant_account_id,document) VALUES($1,$2,$3,$4)',
      [
        customerId,
        ownerId,
        merchantId,
        JSON.stringify({
          contactName: '旧版客户',
          contactPhone: '13800000000',
          companyAddress,
          merchantAccountId: merchantId,
          sourceChannel: '微信',
          status: '已付款',
          lastDealAt: paidAt,
          nextFollowupAt: null,
          productIds: [],
          tagIds: [],
        }),
      ],
    );
    await tx.query('INSERT INTO products(id,sku,document) VALUES($1,$2,$3)', [
      productId,
      'MIGRATION-PRODUCT',
      JSON.stringify({ name: '旧版验收产品', model: '', unit: '件', priceExTax: '100.00' }),
    ]);
    for (const [id, status, date, document] of [
      [unpaidOrderId, '待付款', null, oldOrderDocument('100.00', '7.77', '10.00')],
      [paidOrderId, '已付款', paidAt, oldOrderDocument('40.00', '5.66', '1.00')],
    ] as const) {
      await tx.query(
        'INSERT INTO orders(id,customer_id,status,type,order_date,paid_at,total_incl_tax,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          customerId,
          status,
          document.type,
          document.orderDate,
          date,
          document.totalInclTax,
          JSON.stringify(document),
        ],
      );
    }
    await tx.query(
      'INSERT INTO payment_changes(id,order_id,actor_id,previous_status,next_status,amount,paid_at,payment_note,previous_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        paymentId,
        paidOrderId,
        ownerId,
        '待付款',
        '已付款',
        '88.66',
        paidAt,
        '旧版人工登记付款',
        JSON.stringify({ paidAt: null, paymentNote: '' }),
      ],
    );
  });
  expect((await database.query("SELECT to_regclass('customer_drafts') AS name")).rows[0].name).toBe(
    null,
  );
  expect(
    (await database.query("SELECT to_regclass('waybill_attachments') AS name")).rows[0].name,
  ).toBe(null);
  expect(
    (
      await database.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='payment_changes' AND column_name='receiving_account'",
        [schema],
      )
    ).rows,
  ).toEqual([]);
  legacyRows = await snapshotLegacyRows();
  await database.migrate();
  core = new CoreService(database, new AuthService(database));
});

afterAll(async () => {
  try {
    if (database && schemaCreated) {
      expect((await database.query('SELECT current_database() AS name')).rows[0].name).toBe(
        'business_test',
      );
      if (!/^refinement_migration_[a-f0-9]{32}$/.test(schema))
        throw new Error('INVALID_TEST_SCHEMA');
      await database.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  } finally {
    if (database) await database.onModuleDestroy();
    vi.unstubAllEnvs();
  }
});

describe('0001–0003 旧库升级到客户草稿与运单版本', () => {
  test('真实旧记录升级后完整保留，缺失收款账号保持空值', async () => {
    const upgraded = await snapshotLegacyRows();
    expect(upgraded.customers).toEqual(legacyRows.customers);
    expect(upgraded.orders).toEqual(legacyRows.orders);
    expect(upgraded.payments).toEqual(
      legacyRows.payments.map((payment) => ({ ...payment, receiving_account: '' })),
    );
    expect(upgraded.customers[0].document.companyAddress).toBe(companyAddress);
    expect(upgraded.customers[0].document).not.toHaveProperty('deliveryAddress');
    expect(upgraded.orders.map((order) => order.document.taxFee).sort()).toEqual(['5.66', '7.77']);
    for (const order of upgraded.orders) {
      expect(order.document).not.toHaveProperty('taxFeeMode');
      expect(order.document).not.toHaveProperty('receivingAccount');
    }
    expect((await core.listPayments(owner, paidOrderId))[0]).toMatchObject({
      amount: '88.66',
      receivingAccount: '',
      previousValue: { paidAt: null, paymentNote: '' },
    });
    expect((await database.query('SELECT name FROM schema_migrations ORDER BY name')).rows).toEqual(
      ['0001.sql', '0002.sql', '0003.sql', '0004.sql', '0005.sql'].map((name) => ({ name })),
    );
  });

  test('升级后编辑旧订单仍保留手工税费、已付款金额与公司地址快照', async () => {
    const unpaid = await core.getOrder(owner, unpaidOrderId);
    const updated = await core.updateOrder(owner, unpaidOrderId, {
      version: unpaid.version,
      note: '升级后修改备注',
    });
    expect(updated).toMatchObject({
      goodsTotal: '200.00',
      taxFee: '7.77',
      taxFeeMode: 'manual',
      taxRate: '0',
      totalInclTax: '219.77',
      totalInclTaxOverride: null,
      recipientAddress: companyAddress,
    });
    const paid = await core.getOrder(owner, paidOrderId);
    const paidUpdated = await core.updateOrder(owner, paidOrderId, {
      version: paid.version,
      note: '已付款旧订单补充备注',
    });
    expect(paidUpdated).toMatchObject({
      status: '已付款',
      taxFee: '5.66',
      totalInclTax: '88.66',
      recipientAddress: companyAddress,
    });
    expect(paidUpdated).not.toHaveProperty('receivingAccount');
    expect((await core.listPayments(owner, paidOrderId))[0].receivingAccount).toBe('');
    const customer = await core.getCustomer(owner, customerId);
    await core.updateCustomer(owner, customerId, {
      version: customer.version,
      companyAddress: '更新后的公司地址',
      deliveryAddress: '升级后新增收货地址',
    });
    expect((await core.getOrder(owner, unpaidOrderId)).recipientAddress).toBe(companyAddress);
    expect((await core.getOrder(owner, paidOrderId)).recipientAddress).toBe(companyAddress);
  });

  test('升级后的草稿与运单结构可用，约束与旧订单绑定生效', async () => {
    expect(await core.getCustomerDraft(owner)).toMatchObject({ document: null, version: 0 });
    const saved = await core.saveCustomerDraft(owner, {
      version: 0,
      document: { deliveryAddress: '升级后的不完整客户草稿' },
    });
    expect(saved).toMatchObject({
      document: { deliveryAddress: '升级后的不完整客户草稿' },
      version: 1,
    });
    await expect(
      database.query("UPDATE customer_drafts SET document='[]'::jsonb WHERE user_id=$1", [ownerId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.query('UPDATE customer_drafts SET version=-1 WHERE user_id=$1', [ownerId]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await core.clearCustomerDraft(owner, { version: 1 })).toMatchObject({
      document: null,
      version: 2,
    });
    await database.query(
      'INSERT INTO waybill_attachments(id,uploader_id,storage_key,original_name,media_type,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [attachmentId, ownerId, `${attachmentId}.upload`, 'migration.png', 'image/png', 100, 1, 1],
    );
    expect(
      (await database.query('SELECT * FROM waybill_attachments WHERE id=$1', [attachmentId]))
        .rows[0],
    ).toMatchObject({ order_id: null, deleted_at: null, uploader_id: ownerId });
    const order = await core.getOrder(owner, unpaidOrderId);
    const linked = await core.updateOrder(owner, unpaidOrderId, {
      version: order.version,
      shipments: [{ freightPayment: '现付', attachmentIds: [attachmentId] }],
    });
    expect(linked.shipments[0].attachmentIds).toEqual([attachmentId]);
    expect(linked.totalInclTax).toBe('219.77');
    expect(
      (await database.query('SELECT order_id FROM waybill_attachments WHERE id=$1', [attachmentId]))
        .rows[0].order_id,
    ).toBe(unpaidOrderId);
    await expect(
      database.query('UPDATE waybill_attachments SET order_id=$2 WHERE id=$1', [
        attachmentId,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      database.query('UPDATE waybill_attachments SET bytes=10485761 WHERE id=$1', [attachmentId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.query('UPDATE payment_changes SET receiving_account=$2 WHERE id=$1', [
        paymentId,
        'x'.repeat(201),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('重复及并发调用正式迁移入口不重复应用或修改现有记录', async () => {
    const before = await snapshotAllRows();
    await database.migrate();
    await Promise.all([database.migrate(), database.migrate()]);
    expect(await snapshotAllRows()).toEqual(before);
    expect((await database.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
  });
});
