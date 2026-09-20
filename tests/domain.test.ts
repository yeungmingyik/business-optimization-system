import { describe, expect, it } from 'vitest';
import { amount, cents, dayRange, orderSchema, parse } from '../apps/api/src/validation';

describe('金额与日期边界', () => {
  it('按分计算，避免小数精度误差', () => {
    expect(amount(cents('0.10') * 3n + cents('0.20'))).toBe('0.50');
    expect(amount(cents('999999999999.99'))).toBe('999999999999.99');
    expect(() => amount(cents('999999999999.99') + 1n)).toThrow();
    expect(() => amount(-1n)).toThrow();
  });
  it('上海时区的跨月查询保持半开区间', () => {
    expect(dayRange({ startDate: '2026-02-28', endDate: '2026-03-01' })).toMatchObject({
      start: '2026-02-27T16:00:00.000Z',
      end: '2026-03-01T16:00:00.000Z',
    });
    expect(() => dayRange({ startDate: '2026-02-30' })).toThrow();
    expect(() => dayRange({ startDate: '2026-03-02', endDate: '2026-03-01' })).toThrow();
  });
  it('拒绝不存在的订单日期', () => {
    expect(() => parse(orderSchema, { orderDate: '2026-02-30' })).toThrow();
  });
});
