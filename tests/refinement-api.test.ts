import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, testPassword } from './api-client';

const boss = new ApiClient();
const operator = new ApiClient();
const colleague = new ApiClient();
const runId = `refine-${randomUUID().slice(0, 12)}`;
const paidAt = new Date(Date.now() - 60000).toISOString();
const day = new Date(Date.parse(paidAt) + 28800000).toISOString().slice(0, 10);
let merchant: any;
let product: any;
let customer: any;

function resultBody(response: any) {
  expect(response.status, JSON.stringify(response.body)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return response.body;
}

const customerInput = () => ({
  contactName: `${runId}-客户`,
  merchantAccountId: merchant.id,
  sourceChannel: '微信',
  companyAddress: '上海市浦东新区办公地址 1 号',
  deliveryAddress: '上海市闵行区收货地址 2 号',
});

const orderInput = (patch: Record<string, unknown> = {}) => ({
  customerId: customer.id,
  orderDate: day,
  recipientName: customer.contactName,
  recipientPhone: '13800000000',
  recipientAddress: customer.deliveryAddress,
  lines: [{ productId: product.id, quantity: 1, unitPriceExTax: '100.00' }],
  freightFee: '5.00',
  packagingFee: '2.00',
  taxRate: '13',
  taxFeeMode: 'auto',
  ...patch,
});

async function draft(client = operator) {
  return resultBody(await client.request('GET', '/customer-drafts/current'));
}

async function createOperator(client: ApiClient, suffix: string) {
  const loginName = `${runId}-${suffix}`;
  const created = resultBody(
    await boss.request('POST', '/users', {
      loginName,
      displayName: `优化运营-${suffix}`,
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

beforeAll(async () => {
  await boss.login('test-owner', 'TestOwner2026!Local');
  await createOperator(operator, 'one');
  await createOperator(colleague, 'two');
  merchant = resultBody(
    await boss.request('POST', '/merchant-accounts', {
      name: `优化账号-${runId}`,
      platform: '微信',
    }),
  );
  product = resultBody(
    await operator.request('POST', '/products', {
      sku: `REF-${runId}`,
      name: '税率测试产品',
      priceExTax: '100.00',
    }),
  );
  customer = resultBody(await operator.request('POST', '/customers', customerInput()));
});

describe('客户收货地址与草稿', () => {
  it('收货地址与企业地址独立保存并执行客户归属权限', async () => {
    expect(customer.companyAddress).toBe(customerInput().companyAddress);
    expect(customer.deliveryAddress).toBe(customerInput().deliveryAddress);
    customer = resultBody(
      await operator.request('PATCH', `/customers/${customer.id}`, {
        version: customer.version,
        deliveryAddress: '上海市松江区收货地址 3 号',
      }),
    );
    expect(customer.companyAddress).toBe(customerInput().companyAddress);
    expect(customer.deliveryAddress).toBe('上海市松江区收货地址 3 号');
    expect((await colleague.request('GET', `/customers/${customer.id}`)).status).toBe(404);
  });

  it('不完整草稿保留原始输入且不同账号相互隔离', async () => {
    expect(await draft()).toEqual({ document: null, version: 0, updatedAt: null });
    const document = {
      contactName: '  未完成联系人 ',
      deliveryAddress: '收货地址第一行\n第二行',
      merchantAccountId: '',
      sourceChannel: '',
      status: '',
      ownerId: '',
      lastDealAt: '',
      nextFollowupAt: '2026-09-23T09:30',
      productIds: [product.id],
      tagIds: [],
    };
    const saved = resultBody(
      await operator.request('PUT', '/customer-drafts/current', {
        version: 0,
        document,
      }),
    );
    expect(saved).toMatchObject({ version: 1, document });
    expect(saved.updatedAt).toBeTruthy();
    expect(await draft()).toEqual(saved);
    expect((await draft(colleague)).document).toBeNull();
    expect((await new ApiClient().request('GET', '/customer-drafts/current')).status).toBe(401);
    expect(
      (
        await operator.request('PUT', '/customer-drafts/current', {
          version: 1,
          document,
          userId: colleague.user.id,
        })
      ).status,
    ).toBe(422);
  });

  it('草稿仅接收约定字段并拒绝覆盖并发更新', async () => {
    const current = await draft();
    for (const document of [
      { id: customer.id },
      { contactName: 'x'.repeat(201) },
      { productIds: ['invalid'] },
    ]) {
      expect(
        (
          await operator.request('PUT', '/customer-drafts/current', {
            version: current.version,
            document,
          })
        ).status,
      ).toBe(422);
    }
    const results = await Promise.all(
      ['并发甲', '并发乙'].map((contactName) =>
        operator.request('PUT', '/customer-drafts/current', {
          version: current.version,
          document: { contactName },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = results.find((r) => r.status === 200)!.body;
    expect(await draft()).toEqual(saved);
  });

  it('客户校验失败保留草稿，成功保存原子清除且迟到保存不能恢复旧草稿', async () => {
    const current = await draft();
    expect(
      (
        await operator.request('POST', '/customers', {
          ...customerInput(),
          contactName: '',
          draftVersion: current.version,
        })
      ).status,
    ).toBe(422);
    expect(await draft()).toEqual(current);
    expect(
      (
        await operator.request('POST', '/customers', {
          ...customerInput(),
          merchantAccountId: randomUUID(),
          draftVersion: current.version,
        })
      ).status,
    ).toBe(422);
    expect(await draft()).toEqual(current);
    const created = resultBody(
      await operator.request('POST', '/customers', {
        ...customerInput(),
        draftVersion: current.version,
      }),
    );
    expect(created.deliveryAddress).toBe(customerInput().deliveryAddress);
    expect(await draft()).toMatchObject({ document: null, version: current.version + 1 });
    expect(
      (
        await operator.request('PUT', '/customer-drafts/current', {
          version: current.version,
          document: current.document,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await operator.request('POST', '/customers', {
          ...customerInput(),
          draftVersion: current.version,
        })
      ).status,
    ).toBe(409);
    expect((await draft()).document).toBeNull();
  });

  it('清除草稿保留版本，未携带草稿版本的客户保存不消费草稿', async () => {
    const current = await draft();
    const saved = resultBody(
      await operator.request('PUT', '/customer-drafts/current', {
        version: current.version,
        document: { contactName: '待续写客户' },
      }),
    );
    resultBody(await operator.request('POST', '/customers', customerInput()));
    expect(await draft()).toEqual(saved);
    const cleared = resultBody(
      await operator.request('DELETE', '/customer-drafts/current', {
        version: saved.version,
      }),
    );
    expect(cleared).toMatchObject({ document: null, version: saved.version + 1 });
    expect(
      (
        await operator.request('DELETE', '/customer-drafts/current', {
          version: saved.version,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await operator.request('PUT', '/customer-drafts/current', {
          version: 0,
          document: saved.document,
        })
      ).status,
    ).toBe(409);
  });
});

describe('税率、汇总金额与收款账号', () => {
  it('自动税费仅按商品总额计算并以服务端结果覆盖客户端金额', async () => {
    const order = resultBody(
      await operator.request(
        'POST',
        '/orders',
        orderInput({
          taxFee: '999.00',
          calculatedTaxFee: '999.00',
          calculatedTotalInclTax: '999.00',
          totalInclTax: '999.00',
        }),
      ),
    );
    expect(order).toMatchObject({
      goodsTotal: '100.00',
      taxRate: '13',
      taxFeeMode: 'auto',
      taxFee: '13.00',
      calculatedTaxFee: '13.00',
      totalExTax: '107.00',
      calculatedTotalInclTax: '120.00',
      totalInclTax: '120.00',
      totalInclTaxOverride: null,
    });
  });

  it('税费按分四舍五入并支持四位小数百分比', async () => {
    const cases = [
      ['0.05', '10', '0.01'],
      ['0.04', '10', '0.00'],
      ['100.00', '1.2345', '1.23'],
      ['100.00', '1.235', '1.24'],
      ['0.01', '100', '0.01'],
    ];
    for (const [price, rate, expected] of cases) {
      const order = resultBody(
        await operator.request(
          'POST',
          '/orders',
          orderInput({
            lines: [{ productId: product.id, quantity: 1, unitPriceExTax: price }],
            taxRate: rate,
          }),
        ),
      );
      expect(order.taxFee).toBe(expected);
    }
  });

  it('手工税费和含税总额覆盖可保留并能恢复自动计算', async () => {
    let order = resultBody(
      await operator.request(
        'POST',
        '/orders',
        orderInput({
          taxFeeMode: 'manual',
          taxFee: '9.00',
          totalInclTaxOverride: '110.00',
        }),
      ),
    );
    expect(order).toMatchObject({
      taxFee: '9.00',
      calculatedTaxFee: '13.00',
      calculatedTotalInclTax: '116.00',
      totalInclTax: '110.00',
    });
    const originalVersion = order.version;
    order = resultBody(
      await operator.request('PATCH', `/orders/${order.id}`, {
        version: order.version,
        lines: [{ productId: product.id, quantity: 2, unitPriceExTax: '100.00' }],
      }),
    );
    expect(order).toMatchObject({
      taxFee: '9.00',
      calculatedTaxFee: '26.00',
      calculatedTotalInclTax: '216.00',
      totalInclTax: '110.00',
    });
    expect(
      (
        await operator.request('PATCH', `/orders/${order.id}`, {
          version: originalVersion,
          totalInclTaxOverride: '1.00',
        })
      ).status,
    ).toBe(409);
    order = resultBody(
      await operator.request('PATCH', `/orders/${order.id}`, {
        version: order.version,
        taxFeeMode: 'auto',
        totalInclTaxOverride: null,
      }),
    );
    expect(order).toMatchObject({
      taxFee: '26.00',
      calculatedTotalInclTax: '233.00',
      totalInclTax: '233.00',
      totalInclTaxOverride: null,
    });
  });

  it('旧格式手工税费保持原值并拒绝非法税率或覆盖金额', async () => {
    const legacy = orderInput({ taxFee: '4.50' });
    delete (legacy as any).taxRate;
    delete (legacy as any).taxFeeMode;
    const order = resultBody(await operator.request('POST', '/orders', legacy));
    expect(order).toMatchObject({
      taxFeeMode: 'manual',
      taxFee: '4.50',
      taxRate: '0',
      totalInclTax: '111.50',
    });
    for (const taxRate of ['-1', '100.0001', '1.23456', '1e1', 'NaN']) {
      expect((await operator.request('POST', '/orders', orderInput({ taxRate }))).status).toBe(422);
    }
    for (const totalInclTaxOverride of ['-0.01', '0.001', '1000000000000.00']) {
      expect(
        (await operator.request('POST', '/orders', orderInput({ totalInclTaxOverride }))).status,
      ).toBe(422);
    }
  });

  it('商品和含税金额溢出不能通过手工覆盖绕过，失败更新不改变原订单', async () => {
    const order = resultBody(await operator.request('POST', '/orders', orderInput()));
    for (const patch of [
      {
        lines: [{ productId: product.id, quantity: 999999, unitPriceExTax: '999999999999.99' }],
        totalInclTaxOverride: '1.00',
      },
      {
        lines: [{ productId: product.id, quantity: 1, unitPriceExTax: '999999999999.99' }],
        freightFee: '0.00',
        packagingFee: '0.00',
        taxRate: '100',
        totalInclTaxOverride: '1.00',
      },
      { taxFeeMode: 'manual', taxFee: '-1.00' },
      { taxFeeMode: 'manual', taxFee: '0.001' },
    ]) {
      expect(
        (
          await operator.request('PATCH', `/orders/${order.id}`, {
            version: order.version,
            ...patch,
          })
        ).status,
      ).toBe(422);
      expect(resultBody(await operator.request('GET', `/orders/${order.id}`))).toEqual(order);
    }
  });

  it('付款要求收款账号并采用最终汇总金额，已付款金额和归属权限不可绕过', async () => {
    const pending = resultBody(
      await operator.request('POST', '/orders', orderInput({ totalInclTaxOverride: '99.00' })),
    );
    for (const receivingAccount of [undefined, '', ' '.repeat(3), 'x'.repeat(201)]) {
      expect(
        (
          await operator.request('POST', `/orders/${pending.id}/payment`, {
            version: pending.version,
            paidAt,
            receivingAccount,
          })
        ).status,
      ).toBe(422);
    }
    const paid = resultBody(
      await operator.request('POST', `/orders/${pending.id}/payment`, {
        version: pending.version,
        paidAt,
        receivingAccount: '  工商银行 6222 0000 甲公司  ',
      }),
    );
    expect(paid.receivingAccount).toBe('工商银行 6222 0000 甲公司');
    expect(paid.totalInclTax).toBe('99.00');
    const events = resultBody(await operator.request('GET', `/orders/${paid.id}/payments`));
    expect(events[0]).toMatchObject({
      amount: '99.00',
      receivingAccount: paid.receivingAccount,
      previousValue: { receivingAccount: '' },
    });
    for (const field of ['taxRate', 'taxFeeMode', 'totalInclTaxOverride', 'receivingAccount']) {
      expect(
        (
          await operator.request('PATCH', `/orders/${paid.id}`, {
            version: paid.version,
            [field]: '1',
          })
        ).status,
      ).toBe(422);
    }
    expect((await colleague.request('GET', `/orders/${paid.id}/payments`)).status).toBe(404);
    expect(
      (
        await colleague.request('POST', `/orders/${paid.id}/payment`, {
          version: paid.version,
          paidAt,
          receivingAccount: '越权账号',
        })
      ).status,
    ).toBe(404);
    const summary = resultBody(
      await operator.request('GET', `/dashboard/summary?startDate=${day}&endDate=${day}`),
    );
    expect(summary.dealAmount).toBe('99.00');
  });

  it('老板更正保留账号前后值，撤回付款清空当前账号且历史仍可追溯', async () => {
    let order = resultBody(await operator.request('POST', '/orders', orderInput()));
    order = resultBody(
      await operator.request('POST', `/orders/${order.id}/payment`, {
        version: order.version,
        paidAt,
        receivingAccount: '原收款账号',
      }),
    );
    const correction = {
      version: order.version,
      status: '已付款',
      paidAt,
      receivingAccount: '更正收款账号',
      reason: '银行账户录入错误',
    };
    expect(
      (await operator.request('POST', `/orders/${order.id}/payment-correction`, correction)).status,
    ).toBe(403);
    expect(
      (
        await boss.request('POST', `/orders/${order.id}/payment-correction`, {
          ...correction,
          receivingAccount: '',
        })
      ).status,
    ).toBe(422);
    order = resultBody(
      await boss.request('POST', `/orders/${order.id}/payment-correction`, correction),
    );
    expect(order.receivingAccount).toBe('更正收款账号');
    let events = resultBody(await boss.request('GET', `/orders/${order.id}/payments`));
    expect(events[0]).toMatchObject({
      receivingAccount: '更正收款账号',
      previousValue: { receivingAccount: '原收款账号' },
    });
    order = resultBody(
      await boss.request('POST', `/orders/${order.id}/payment-correction`, {
        version: order.version,
        status: '待付款',
        paidAt: null,
        receivingAccount: '不应保留',
        reason: '款项未到账',
      }),
    );
    expect(order).toMatchObject({ status: '待付款', paidAt: null, receivingAccount: '' });
    events = resultBody(await boss.request('GET', `/orders/${order.id}/payments`));
    expect(events[0]).toMatchObject({
      receivingAccount: '',
      previousValue: { receivingAccount: '更正收款账号' },
    });
    expect(events.map((event: any) => event.receivingAccount)).toEqual([
      '',
      '更正收款账号',
      '原收款账号',
    ]);
  });

  it('已付款订单修改物流保留覆盖金额与账号，客户转交后立即执行新归属', async () => {
    let assignedCustomer = resultBody(
      await operator.request('POST', '/customers', customerInput()),
    );
    let order = resultBody(
      await operator.request(
        'POST',
        '/orders',
        orderInput({
          customerId: assignedCustomer.id,
          taxFeeMode: 'manual',
          taxFee: '9.99',
          totalInclTaxOverride: '88.88',
          shipments: [{ carrier: '顺丰', freightPayment: '现付', trackingNo: 'SF10001' }],
        }),
      ),
    );
    order = resultBody(
      await operator.request('POST', `/orders/${order.id}/payment`, {
        version: order.version,
        paidAt,
        receivingAccount: '转交前收款账号',
      }),
    );
    const shipmentId = order.shipments[0].id;
    order = resultBody(
      await operator.request('PATCH', `/orders/${order.id}/shipments/${shipmentId}`, {
        version: order.version,
        trackingNo: 'SF10002',
      }),
    );
    expect(order).toMatchObject({
      taxFeeMode: 'manual',
      taxFee: '9.99',
      totalInclTaxOverride: '88.88',
      totalInclTax: '88.88',
      receivingAccount: '转交前收款账号',
    });
    expect(order.shipments[0]).toMatchObject({
      id: shipmentId,
      carrier: '顺丰',
      freightPayment: '现付',
      trackingNo: 'SF10002',
    });
    assignedCustomer = resultBody(await boss.request('GET', `/customers/${assignedCustomer.id}`));
    resultBody(
      await boss.request('POST', `/customers/${assignedCustomer.id}/assign`, {
        version: assignedCustomer.version,
        ownerId: colleague.user.id,
      }),
    );
    expect((await operator.request('GET', `/orders/${order.id}`)).status).toBe(404);
    expect((await operator.request('GET', `/orders/${order.id}/payments`)).status).toBe(404);
    expect(
      (
        await operator.request('PATCH', `/orders/${order.id}/shipments/${shipmentId}`, {
          version: order.version,
          trackingNo: '越权修改',
        })
      ).status,
    ).toBe(404);
    const transferred = resultBody(await colleague.request('GET', `/orders/${order.id}`));
    expect(transferred.version).toBe(order.version + 1);
    expect(transferred).toMatchObject({
      ownerId: colleague.user.id,
      totalInclTax: '88.88',
      receivingAccount: '转交前收款账号',
    });
    expect(
      (
        await colleague.request('PATCH', `/orders/${order.id}/shipments/${shipmentId}`, {
          version: order.version,
          trackingNo: '过期更新',
        })
      ).status,
    ).toBe(409);
    const changed = resultBody(
      await colleague.request('PATCH', `/orders/${order.id}/shipments/${shipmentId}`, {
        version: transferred.version,
        trackingNo: 'SF10003',
      }),
    );
    expect(changed.shipments[0].trackingNo).toBe('SF10003');
    expect(changed.totalInclTax).toBe('88.88');
    const payments = resultBody(await colleague.request('GET', `/orders/${order.id}/payments`));
    expect(payments[0]).toMatchObject({ amount: '88.88', receivingAccount: '转交前收款账号' });
  });
});
