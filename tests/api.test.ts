import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, testPassword } from './api-client';

const boss = new ApiClient();
const operator = new ApiClient();
const colleague = new ApiClient();
const runId = Date.now().toString(36);
let merchant: any;
let product: any;
let customer: any;
let otherCustomer: any;
let order: any;
let colleagueLogin = '';
const resultBody = (response: any) => {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
};
const orderInput = (customerId: string) => ({
  customerId,
  orderDate: '2026-09-01',
  recipientName: '采购联系人',
  recipientPhone: '13800000000',
  recipientAddress: '测试地址',
  lines: [{ productId: product.id, quantity: 3, unitPriceExTax: '0.10' }],
  freightFee: '0.20',
  packagingFee: '0.30',
  taxFee: '0.40',
});

beforeAll(async () => {
  await boss.login('test-owner', 'TestOwner2026!Local');
  merchant = resultBody(
    await boss.request('POST', '/merchant-accounts', { name: `商家-${runId}`, platform: '淘宝' }),
  );
  for (const [client, suffix] of [
    [operator, 'one'],
    [colleague, 'two'],
  ] as const) {
    const loginName = `op-${runId}-${suffix}`;
    const created = resultBody(
      await boss.request('POST', '/users', {
        loginName,
        displayName: `运营-${suffix}`,
        role: 'OPERATOR',
      }),
    );
    await client.login(loginName, created.temporaryPassword);
    expect((await client.request('GET', '/customers')).status).toBe(403);
    resultBody(
      await client.request('POST', '/auth/change-password', {
        currentPassword: created.temporaryPassword,
        newPassword: testPassword,
      }),
    );
    expect((await client.request('GET', '/auth/me')).status).toBe(401);
    await client.login(loginName, testPassword);
    if (suffix === 'two') colleagueLogin = loginName;
  }
  product = resultBody(
    await operator.request('POST', '/products', {
      sku: `SKU-${runId}`,
      name: `产品-${runId}`,
      model: 'M1',
      unit: '件',
      priceExTax: '0.10',
    }),
  );
  customer = resultBody(
    await operator.request('POST', '/customers', {
      contactName: `客户-${runId}-A`,
      merchantAccountId: merchant.id,
      sourceChannel: '淘宝',
      productIds: [product.id],
    }),
  );
  otherCustomer = resultBody(
    await colleague.request('POST', '/customers', {
      contactName: `客户-${runId}-B`,
      merchantAccountId: merchant.id,
      sourceChannel: '微信',
    }),
  );
});

describe('权限与业务闭环', () => {
  it('拒绝未登录请求与跨站写入', async () => {
    expect((await new ApiClient().request('GET', '/customers')).status).toBe(401);
    expect((await operator.request('POST', '/customers', {}, { 'x-csrf-token': '' })).status).toBe(
      403,
    );
    expect(
      (await operator.request('POST', '/customers', {}, { origin: 'https://untrusted.example' }))
        .status,
    ).toBe(403);
    expect((await operator.request('GET', '/users')).status).toBe(403);
    expect((await operator.request('GET', '/audit-events')).status).toBe(403);
  });

  it('列表、详情、编辑、跟进均执行客户归属权限', async () => {
    const ownList = resultBody(await operator.request('GET', `/customers?q=${runId}`));
    expect(ownList.items.map((item: any) => item.id)).toEqual([customer.id]);
    expect((await operator.request('GET', `/customers/${otherCustomer.id}`)).status).toBe(404);
    expect(
      (
        await operator.request('PATCH', `/customers/${otherCustomer.id}`, {
          version: otherCustomer.version,
          contactName: '越权',
        })
      ).status,
    ).toBe(404);
    expect((await operator.request('GET', `/customers/${otherCustomer.id}/followups`)).status).toBe(
      404,
    );
    expect(resultBody(await boss.request('GET', `/customers?q=${runId}`)).total).toBe(2);
  });

  it('运营无法通过提交负责人字段创建他人名下客户', async () => {
    const created = resultBody(
      await operator.request('POST', '/customers', {
        contactName: `权限-${runId}`,
        merchantAccountId: merchant.id,
        sourceChannel: '电话来电',
        ownerId: colleague.user.id,
      }),
    );
    expect(created.ownerId).toBe(operator.user.id);
    expect((await colleague.request('GET', `/customers/${created.id}`)).status).toBe(404);
  });

  it('保存跟进同步下次跟进时间，并拒绝覆盖过期版本', async () => {
    const nextFollowupAt = new Date(Date.now() - 86400000).toISOString();
    resultBody(
      await operator.request('POST', `/customers/${customer.id}/followups`, {
        version: customer.version,
        content: '已确认采购规格',
        occurredAt: new Date(Date.now() - 7200000).toISOString(),
        contactChannel: '微信',
        nextFollowupAt,
      }),
    );
    const current = resultBody(await operator.request('GET', `/customers/${customer.id}`));
    expect(new Date(current.nextFollowupAt).toISOString()).toBe(nextFollowupAt);
    expect(
      (
        await operator.request('PATCH', `/customers/${customer.id}`, {
          version: customer.version,
          contactName: '过期提交',
        })
      ).status,
    ).toBe(409);
    customer = current;
    const followups = resultBody(
      await operator.request('GET', `/customers/${customer.id}/followups`),
    );
    expect(followups.items[0].content).toBe('已确认采购规格');
    expect(followups.items[0].actorName).toBe(operator.user.displayName);
  });

  it('单次完成跟进任务后不再重复列入逾期待办', async () => {
    expect(
      resultBody(
        await operator.request('GET', `/customers?q=${runId}&followup=overdue`),
      ).items.some((item: any) => item.id === customer.id),
    ).toBe(true);
    resultBody(
      await operator.request('POST', `/customers/${customer.id}/followup-task/complete`, {
        version: customer.version,
        nextFollowupAt: null,
      }),
    );
    customer = resultBody(await operator.request('GET', `/customers/${customer.id}`));
    expect(customer.nextFollowupAt).toBeNull();
  });

  it('订单按分精确计算金额，保存产品快照', async () => {
    order = resultBody(await operator.request('POST', '/orders', orderInput(customer.id)));
    expect(order.goodsTotal).toBe('0.30');
    expect(order.totalExTax).toBe('0.80');
    expect(order.totalInclTax).toBe('1.20');
    expect(order.status).toBe('待付款');
    product = resultBody(
      await operator.request('PATCH', `/products/${product.id}`, {
        version: product.version,
        name: `新名称-${runId}`,
        priceExTax: '9.99',
      }),
    );
    const snapshot = resultBody(await operator.request('GET', `/orders/${order.id}`));
    expect(snapshot.lines[0].unitPriceExTax).toBe('0.10');
    expect(snapshot.lines[0].name).toBe(`产品-${runId}`);
  });

  it('拒绝越权客户下单、负数和超过两位小数的金额', async () => {
    expect((await operator.request('POST', '/orders', orderInput(otherCustomer.id))).status).toBe(
      404,
    );
    expect(
      (await operator.request('POST', '/orders', { ...orderInput(customer.id), taxFee: '-0.01' }))
        .status,
    ).toBe(422);
    expect(
      (await operator.request('POST', '/orders', { ...orderInput(customer.id), taxFee: '0.001' }))
        .status,
    ).toBe(422);
    expect(
      (
        await operator.request('POST', '/orders', {
          ...orderInput(customer.id),
          lines: [{ productId: product.id, quantity: 1.5, unitPriceExTax: '1.00' }],
        })
      ).status,
    ).toBe(422);
  });

  it('待付款订单阻止客户归档', async () => {
    expect(
      (
        await boss.request('POST', `/customers/${customer.id}/archive`, {
          version: customer.version,
        })
      ).status,
    ).toBe(422);
  });

  it('外部来源与原单号组合防止重复录单', async () => {
    const input = {
      ...orderInput(customer.id),
      externalSource: '淘宝',
      externalOrderNo: `external-${runId}`,
    };
    resultBody(await operator.request('POST', '/orders', input));
    expect([409, 422]).toContain((await operator.request('POST', '/orders', input)).status);
  });

  it('登记付款更新客户成交时间，重复或过期操作不重复记账', async () => {
    const version = order.version;
    const paidAt = new Date(Date.now() - 60000).toISOString();
    expect(
      (
        await operator.request('POST', `/orders/${order.id}/payment`, {
          version,
          paidAt,
          receivingAccount: '工商银行 622200001234',
          paymentNote: '',
          totalInclTax: '0.01',
        })
      ).status,
    ).toBe(422);
    resultBody(
      await operator.request('POST', `/orders/${order.id}/payment`, {
        version,
        paidAt,
        receivingAccount: '工商银行 622200001234',
        paymentNote: '银行转账',
      }),
    );
    expect([409, 422]).toContain(
      (
        await operator.request('POST', `/orders/${order.id}/payment`, {
          version,
          paidAt,
          receivingAccount: '工商银行 622200001234',
          paymentNote: '重复',
        })
      ).status,
    );
    order = resultBody(await operator.request('GET', `/orders/${order.id}`));
    customer = resultBody(await operator.request('GET', `/customers/${customer.id}`));
    expect(order.status).toBe('已付款');
    expect(customer.status).toBe('已付款');
    expect(new Date(customer.lastDealAt).toISOString()).toBe(paidAt);
  });

  it('已付款订单锁定金额，允许编辑收货和多条物流', async () => {
    expect(
      (
        await operator.request('PATCH', `/orders/${order.id}`, {
          version: order.version,
          freightFee: '5.00',
        })
      ).status,
    ).toBe(422);
    order = resultBody(
      await operator.request('PATCH', `/orders/${order.id}`, {
        version: order.version,
        recipientAddress: '修改后地址',
        shipments: [
          { carrier: '顺丰', freightPayment: '到付', trackingNo: 'SF2026001' },
          { carrier: '德邦', freightPayment: '现付', trackingNo: 'DB2026002' },
        ],
      }),
    );
    expect(order.totalInclTax).toBe('1.20');
    expect(order.shipments).toHaveLength(2);
  });

  it('运营不能回退付款或客户成交状态', async () => {
    expect(
      (
        await operator.request('POST', `/orders/${order.id}/payment-correction`, {
          version: order.version,
          status: '待付款',
          paidAt: null,
          receivingAccount: '工商银行 622200001234',
          paymentNote: '',
          reason: '更正',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await operator.request('PATCH', `/customers/${customer.id}`, {
          version: customer.version,
          status: '待跟进',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await operator.request('PATCH', `/customers/${customer.id}`, {
          version: customer.version,
          lastDealAt: null,
        })
      ).status,
    ).toBe(422);
  });

  it('老板更正付款不自动清空客户成交历史', async () => {
    expect(
      (
        await boss.request('POST', `/orders/${order.id}/payment-correction`, {
          version: order.version,
          status: '待付款',
          paidAt: null,
          receivingAccount: '工商银行 622200001234',
          paymentNote: '',
          reason: '',
        })
      ).status,
    ).toBe(422);
    const previousDealAt = customer.lastDealAt;
    resultBody(
      await boss.request('POST', `/orders/${order.id}/payment-correction`, {
        version: order.version,
        status: '待付款',
        paidAt: null,
        receivingAccount: '工商银行 622200001234',
        paymentNote: '',
        reason: '登记到错误订单',
      }),
    );
    order = resultBody(await operator.request('GET', `/orders/${order.id}`));
    customer = resultBody(await operator.request('GET', `/customers/${customer.id}`));
    expect(order.status).toBe('待付款');
    expect(customer.lastDealAt).toBe(previousDealAt);
    expect(customer.status).toBe('已付款');
  });

  it('转交客户立即改变历史订单与跟进访问权', async () => {
    resultBody(
      await boss.request('POST', `/customers/${customer.id}/assign`, {
        version: customer.version,
        ownerId: colleague.user.id,
      }),
    );
    expect((await operator.request('GET', `/customers/${customer.id}`)).status).toBe(404);
    expect((await operator.request('GET', `/orders/${order.id}`)).status).toBe(404);
    expect((await operator.request('GET', `/customers/${customer.id}/followups`)).status).toBe(404);
    expect(resultBody(await colleague.request('GET', `/orders/${order.id}`)).ownerId).toBe(
      colleague.user.id,
    );
    const history = resultBody(
      await colleague.request('GET', `/customers/${customer.id}/followups`),
    );
    expect(history.items[0].actorName).toBe(operator.user.displayName);
    const ownOrders = resultBody(
      await operator.request('GET', `/orders?customerId=${customer.id}`),
    );
    expect(ownOrders.total).toBe(0);
  });

  it('取消订单必须填原因，终态订单不可重新付款', async () => {
    const pending = resultBody(
      await colleague.request('POST', '/orders', orderInput(otherCustomer.id)),
    );
    expect(
      (
        await colleague.request('POST', `/orders/${pending.id}/cancel`, {
          version: pending.version,
          reason: '',
        })
      ).status,
    ).toBe(422);
    resultBody(
      await colleague.request('POST', `/orders/${pending.id}/cancel`, {
        version: pending.version,
        reason: '客户取消采购',
      }),
    );
    const cancelled = resultBody(await colleague.request('GET', `/orders/${pending.id}`));
    expect(cancelled.status).toBe('取消付款');
    expect([409, 422]).toContain(
      (
        await colleague.request('POST', `/orders/${pending.id}/payment`, {
          version: cancelled.version,
          paidAt: new Date().toISOString(),
          receivingAccount: '工商银行 622200001234',
          paymentNote: '',
        })
      ).status,
    );
  });

  it('老板和运营统计分别遵循全量与当前负责人范围', async () => {
    order = resultBody(await colleague.request('GET', `/orders/${order.id}`));
    resultBody(
      await colleague.request('POST', `/orders/${order.id}/payment`, {
        version: order.version,
        paidAt: new Date().toISOString(),
        receivingAccount: '工商银行 622200001234',
        paymentNote: '更正后登记',
      }),
    );
    const own = resultBody(await operator.request('GET', '/dashboard/summary'));
    expect(own.dealAmount).toBe('0.00');
    const colleagueSummary = resultBody(await colleague.request('GET', '/dashboard/summary'));
    expect(colleagueSummary.dealAmount).toBe('1.20');
    const bossSummary = resultBody(
      await boss.request('GET', `/dashboard/summary?ownerId=${colleague.user.id}`),
    );
    expect(bossSummary.dealAmount).toBe('1.20');
  });

  it('审计保存操作者和关键操作但不记录密码', async () => {
    const audit = resultBody(await boss.request('GET', `/audit-events?pageSize=100&q=${order.id}`));
    const serialized = JSON.stringify(audit);
    expect(audit.items.length).toBeGreaterThan(0);
    expect(serialized).not.toContain(testPassword);
    expect(serialized).not.toContain('password_hash');
  });

  it('停用账号撤销已有会话，不能再次登录', async () => {
    const users = resultBody(await boss.request('GET', '/users?pageSize=100'));
    const user = users.items.find((item: any) => item.id === colleague.user.id);
    resultBody(
      await boss.request('PATCH', `/users/${user.id}`, {
        version: user.version,
        accountStatus: 'DISABLED',
      }),
    );
    expect((await colleague.request('GET', '/customers')).status).toBe(401);
    const response = await new ApiClient().request('POST', '/auth/login', {
      loginName: colleagueLogin,
      password: testPassword,
    });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe('账号或密码错误');
  });

  it('保留最后一个启用老板账号', async () => {
    const users = resultBody(await boss.request('GET', '/users?pageSize=100'));
    const user = users.items.find((item: any) => item.id === boss.user.id);
    expect(
      (
        await boss.request('PATCH', `/users/${user.id}`, {
          version: user.version,
          accountStatus: 'DISABLED',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await boss.request('PATCH', `/users/${user.id}`, {
          version: user.version,
          role: 'OPERATOR',
        })
      ).status,
    ).toBe(422);
  });

  it('退出立即撤销旧会话', async () => {
    const session = new ApiClient();
    await session.login(operator.user.loginName, testPassword);
    const savedCookie = session.cookie;
    resultBody(await session.request('POST', '/auth/logout'));
    session.cookie = savedCookie;
    expect((await session.request('GET', '/auth/me')).status).toBe(401);
  });
});
