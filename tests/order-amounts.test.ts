import { describe, expect, test } from 'vitest';
import { calculateOrderAmounts } from '../apps/web/src/lib/order-amounts';

const fees = {
  freightFee: '10.00',
  packagingFee: '2.00',
  taxRate: '13',
  taxFee: '0.00',
  taxFeeMode: 'auto' as const,
  totalInclTaxOverride: null,
};

describe('订单金额预览', () => {
  test('只对商品金额计税并将其他费用计入总额', () => {
    expect(calculateOrderAmounts([{ quantity: 2, unitPriceExTax: '100.00' }], fees)).toMatchObject({
      goods: '200.00',
      tax: '26.00',
      subtotal: '212.00',
      total: '238.00',
    });
  });

  test('税率精确到四位小数并在分位四舍五入', () => {
    expect(
      calculateOrderAmounts([{ quantity: 1, unitPriceExTax: '0.05' }], { ...fees, taxRate: '10' })
        .tax,
    ).toBe('0.01');
    expect(
      calculateOrderAmounts([{ quantity: 1, unitPriceExTax: '10000.00' }], {
        ...fees,
        taxRate: '13.1234',
      }).tax,
    ).toBe('1312.34');
  });

  test('手动金额和计算金额分别保留，零值可作为有效调整', () => {
    const result = calculateOrderAmounts([{ quantity: 2, unitPriceExTax: '100.00' }], {
      ...fees,
      taxFeeMode: 'manual',
      taxFee: '8.00',
      totalInclTaxOverride: '0.00',
    });
    expect(result).toMatchObject({
      calculatedTax: '26.00',
      tax: '8.00',
      calculatedTotal: '220.00',
      total: '0.00',
    });
  });
});
