import { cents, decimal } from './utils';
import type { OrderLine } from './types';

export function calculateOrderAmounts(
  lines: Pick<OrderLine, 'quantity' | 'unitPriceExTax'>[],
  fees: {
    freightFee: string;
    packagingFee: string;
    taxRate: string;
    taxFee: string;
    taxFeeMode: 'auto' | 'manual';
    totalInclTaxOverride: string | null;
  },
) {
  const goods = lines.reduce(
    (sum, line) =>
      sum +
      cents(line.unitPriceExTax) *
        BigInt(Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0),
    0n,
  );
  const subtotal = goods + cents(fees.freightFee) + cents(fees.packagingFee);
  const [rateWhole, rateFraction = ''] = /^\d{1,3}(\.\d{0,4})?$/.test(fees.taxRate)
    ? fees.taxRate.split('.')
    : ['0'];
  const rate = BigInt(rateWhole) * 10000n + BigInt(rateFraction.padEnd(4, '0'));
  const calculatedTax = (goods * rate + 500000n) / 1000000n;
  const tax = fees.taxFeeMode === 'auto' ? calculatedTax : cents(fees.taxFee);
  const calculatedTotal = subtotal + tax;
  const total =
    fees.totalInclTaxOverride === null ? calculatedTotal : cents(fees.totalInclTaxOverride);
  return {
    goods: decimal(goods),
    subtotal: decimal(subtotal),
    calculatedTax: decimal(calculatedTax),
    tax: decimal(tax),
    calculatedTotal: decimal(calculatedTotal),
    total: decimal(total),
  };
}
