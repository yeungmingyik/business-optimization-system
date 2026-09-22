import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, testPassword } from './api-client';

const boss = new ApiClient();
const operator = new ApiClient();
const colleague = new ApiClient();
const runId = `scope-${randomUUID().slice(0, 12)}`;
const paidAt = new Date(Date.now() - 60000).toISOString();
const day = new Date(Date.parse(paidAt) + 28800000).toISOString().slice(0, 10);
const dateQuery = `startDate=${day}&endDate=${day}`;
const orderQuery = `${dateQuery}&dateField=paidAt&type=${encodeURIComponent('正常')}&status=${encodeURIComponent('已付款')}`;
let merchant: any;
let disabledMerchant: any;
let product: any;
let archivedCustomer: any;
let archivedOrder: any;
let activeOrder: any;
let otherCustomer: any;
let otherOrder: any;

function resultBody(response: any) {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
}

async function createOperator(client: ApiClient, suffix: string) {
  const loginName = `${runId}-${suffix}`;
  const created = resultBody(
    await boss.request('POST', '/users', {
      loginName,
      displayName: `指标运营-${suffix}`,
      role: 'OPERATOR',
    }),
  );
  await client.login(loginName, created.temporaryPassword);
  resultBody(
    await client.request('POST', '/auth/change-password', {
      currentPassword: created.temporaryPassword,
      newPassword: testPassword,
    }),
  );
  await client.login(loginName, testPassword);
}

async function createPaidOrder(
  client: ApiClient,
  suffix: string,
  price: string,
  archive: boolean,
  withFollowup = false,
) {
  let customer = resultBody(
    await client.request('POST', '/customers', {
      contactName: `${runId}-${suffix}`,
      merchantAccountId: merchant.id,
      sourceChannel: '企业微信',
    }),
  );
  if (withFollowup) {
    resultBody(
      await client.request('POST', `/customers/${customer.id}/followups`, {
        version: customer.version,
        content: '确认采购数量',
        occurredAt: paidAt,
        contactChannel: '企业微信',
        nextFollowupAt: null,
      }),
    );
  }
  const pending = resultBody(
    await client.request('POST', '/orders', {
      customerId: customer.id,
      orderDate: day,
      recipientName: customer.contactName,
      recipientPhone: '13800000000',
      recipientAddress: '测试地址',
      lines: [{ productId: product.id, quantity: 1, unitPriceExTax: price }],
    }),
  );
  const order = resultBody(
    await client.request('POST', `/orders/${pending.id}/payment`, {
      version: pending.version,
      paidAt,
      receivingAccount: '工商银行 622200001234',
      paymentNote: '银行转账',
    }),
  );
  customer = resultBody(await client.request('GET', `/customers/${customer.id}`));
  if (archive)
    customer = resultBody(
      await boss.request('POST', `/customers/${customer.id}/archive`, {
        version: customer.version,
      }),
    );
  return { customer, order };
}

beforeAll(async () => {
  await boss.login('test-owner', 'TestOwner2026!Local');
  await createOperator(operator, 'one');
  await createOperator(colleague, 'two');
  merchant = resultBody(
    await boss.request('POST', '/merchant-accounts', {
      name: `${runId}-enabled`,
      platform: '企业微信',
    }),
  );
  disabledMerchant = resultBody(
    await boss.request('POST', '/merchant-accounts', {
      name: `${runId}-disabled`,
      platform: '微信',
      enabled: false,
    }),
  );
  product = resultBody(
    await operator.request('POST', '/products', {
      sku: runId,
      name: '指标核对产品',
      priceExTax: '17.75',
    }),
  );
  const archived = await createPaidOrder(operator, 'archived', '17.75', true, true);
  archivedCustomer = archived.customer;
  archivedOrder = archived.order;
  activeOrder = (await createPaidOrder(operator, 'active', '31.25', false)).order;
  const other = await createPaidOrder(colleague, 'other', '99.90', true);
  otherCustomer = other.customer;
  otherOrder = other.order;
});

describe('指标下钻与分页范围', () => {
  it('归档客户成交保留在指标及全部订单下钻中', async () => {
    const summary = resultBody(await operator.request('GET', `/dashboard/summary?${dateQuery}`));
    expect(summary.dealAmount).toBe('49.00');
    expect(summary.dealOrderCount).toBe(2);
    const allOrders = resultBody(
      await operator.request('GET', `/orders?archived=all&${orderQuery}`),
    );
    expect(allOrders.total).toBe(2);
    expect(allOrders.items.map((item: any) => item.id).sort()).toEqual(
      [archivedOrder.id, activeOrder.id].sort(),
    );
    expect(
      allOrders.items.reduce(
        (sum: number, item: any) => sum + Math.round(Number(item.totalInclTax) * 100),
        0,
      ),
    ).toBe(4900);
    const ownerSummary = resultBody(
      await boss.request('GET', `/dashboard/summary?ownerId=${operator.user.id}&${dateQuery}`),
    );
    expect(ownerSummary.dealAmount).toBe(summary.dealAmount);
    const bossOrders = resultBody(
      await boss.request('GET', `/orders?archived=all&ownerId=${operator.user.id}&${orderQuery}`),
    );
    expect(bossOrders.total).toBe(summary.dealOrderCount);
  });

  it('默认订单列表排除归档客户，归档列表仅包含归档客户', async () => {
    const activeOrders = resultBody(await operator.request('GET', `/orders?${orderQuery}`));
    expect(activeOrders.total).toBe(1);
    expect(activeOrders.items.map((item: any) => item.id)).toEqual([activeOrder.id]);
    const archivedOrders = resultBody(
      await operator.request('GET', `/orders?archived=true&${orderQuery}`),
    );
    expect(archivedOrders.total).toBe(1);
    expect(archivedOrders.items.map((item: any) => item.id)).toEqual([archivedOrder.id]);
  });

  it('全部归档状态不会扩大运营归属权限', async () => {
    const forged = resultBody(
      await operator.request(
        'GET',
        `/orders?archived=all&ownerId=${colleague.user.id}&${orderQuery}`,
      ),
    );
    expect(forged.total).toBe(2);
    expect(forged.items.some((item: any) => item.id === otherOrder.id)).toBe(false);
    expect(
      resultBody(
        await operator.request('GET', `/orders?archived=all&customerId=${otherCustomer.id}`),
      ).total,
    ).toBe(0);
    expect((await operator.request('GET', `/orders/${otherOrder.id}`)).status).toBe(404);
    const summary = resultBody(
      await operator.request('GET', `/dashboard/summary?ownerId=${colleague.user.id}&${dateQuery}`),
    );
    expect(summary.dealAmount).toBe('49.00');
    const colleagueOrders = resultBody(
      await colleague.request('GET', `/orders?archived=all&${orderQuery}`),
    );
    expect(colleagueOrders.items.map((item: any) => item.id)).toEqual([otherOrder.id]);
  });

  it('商家账号支持搜索，空页保留可见范围总数', async () => {
    const enabled = resultBody(await operator.request('GET', `/merchant-accounts?q=${runId}`));
    expect(enabled.total).toBe(1);
    expect(enabled.items[0].id).toBe(merchant.id);
    const hidden = resultBody(
      await operator.request('GET', `/merchant-accounts?q=${runId}-disabled&includeArchived=true`),
    );
    expect(hidden.total).toBe(0);
    const all = resultBody(
      await boss.request('GET', `/merchant-accounts?q=${runId}&includeArchived=true`),
    );
    expect(all.total).toBe(2);
    expect(all.items.map((item: any) => item.id).sort()).toEqual(
      [merchant.id, disabledMerchant.id].sort(),
    );
    const operatorEmpty = resultBody(
      await operator.request('GET', `/merchant-accounts?q=${runId}&page=9&pageSize=1`),
    );
    expect(operatorEmpty.items).toEqual([]);
    expect(operatorEmpty.total).toBe(1);
    const bossEmpty = resultBody(
      await boss.request(
        'GET',
        `/merchant-accounts?q=${runId}&includeArchived=true&page=9&pageSize=1`,
      ),
    );
    expect(bossEmpty.items).toEqual([]);
    expect(bossEmpty.total).toBe(2);
  });

  it('归档客户跟进空页保留总数且不泄漏给其他运营', async () => {
    const history = resultBody(
      await operator.request(
        'GET',
        `/customers/${archivedCustomer.id}/followups?page=1&pageSize=1`,
      ),
    );
    expect(history.total).toBe(1);
    expect(history.items[0].content).toBe('确认采购数量');
    const empty = resultBody(
      await operator.request(
        'GET',
        `/customers/${archivedCustomer.id}/followups?page=9&pageSize=1`,
      ),
    );
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(1);
    expect(
      (
        await colleague.request(
          'GET',
          `/customers/${archivedCustomer.id}/followups?page=9&pageSize=1`,
        )
      ).status,
    ).toBe(404);
  });
});
