import { HttpException } from '@nestjs/common';
import { z } from 'zod';

export const channels = [
  '抖音',
  '视频号',
  'YouTube',
  'TikTok',
  'Facebook',
  'Instagram',
  '淘宝',
  '微信',
  '企业微信',
  '公司官网',
  '电话来电',
] as const;
export const uuid = z.string().uuid();
export const text = z.string().trim().max(2000).default('');
export const required = z.string().trim().min(1).max(200);
export const money = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, '金额格式错误')
  .default('0.00');
export const timestamp = z.string().datetime({ offset: true }).nullable().default(null);
export const versioned = z.object({ version: z.number().int().positive() });
export const customerSchema = z.object({
  companyName: text,
  taxId: text,
  companyPhone: text,
  companyAddress: text,
  bankName: text,
  bankAccount: text,
  contactName: required,
  contactPhone: text,
  taobaoId: text,
  wechatId: text,
  wechatName: text,
  douyinId: text,
  merchantAccountId: uuid,
  sourceChannel: z.enum(channels),
  status: z.enum(['待跟进', '已报价', '待付款', '已付款']).default('待跟进'),
  ownerId: uuid.optional(),
  productIds: z.array(uuid).max(100).default([]),
  tagIds: z.array(uuid).max(100).default([]),
  lastDealAt: timestamp,
  nextFollowupAt: timestamp,
});
export const productSchema = z.object({
  sku: required,
  name: required,
  model: text,
  unit: z.string().trim().min(1).max(20).default('件'),
  priceExTax: money,
  categoryId: uuid.nullable().default(null),
  tagIds: z.array(uuid).max(100).default([]),
  assetIds: z.array(uuid).max(100).default([]),
});
export const shipmentSchema = z.object({
  id: uuid.optional(),
  carrier: required,
  freightPayment: z.enum(['到付', '现付']),
  trackingNo: required,
});
export const orderSchema = z.object({
  customerId: uuid,
  orderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) => !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
      '日期无效',
    ),
  recipientName: required,
  recipientPhone: required,
  recipientAddress: z.string().trim().min(1).max(2000),
  invoiceRequired: z.boolean().default(false),
  note: text,
  type: z.enum(['正常', '退货', '维修']).default('正常'),
  originalOrderId: uuid.nullable().default(null),
  externalSource: text,
  externalOrderNo: text,
  freightFee: money,
  packagingFee: money,
  taxFee: money,
  lines: z
    .array(
      z.object({
        productId: uuid,
        quantity: z.number().int().min(1).max(999999),
        unitPriceExTax: money,
        model: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(1000),
  shipments: z.array(shipmentSchema).max(100).default([]),
});
export const followupSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  occurredAt: z.string().datetime({ offset: true }),
  contactChannel: z.enum(channels),
  nextFollowupAt: timestamp,
});
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException(
      {
        code: 'VALIDATION',
        message: '请检查输入字段',
        fieldErrors: result.error.flatten().fieldErrors,
      },
      422,
    );
  return result.data;
}
export function fail(message: string, status = 422, code = 'BUSINESS_RULE'): never {
  throw new HttpException({ code, message, fieldErrors: {} }, status);
}
export function checkVersion(actual: number, input: any) {
  const { version } = parse(versioned, input);
  if (actual !== version) fail('数据已更新，请重新载入', 409, 'VERSION_CONFLICT');
}
export function cents(value: string) {
  const [whole, fractional = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
}
export function formatAmount(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
export function amount(value: bigint) {
  if (value < 0n || value > 99999999999999n) fail('金额超出范围');
  return formatAmount(value);
}
export function notFuture(value: string | null) {
  if (value && new Date(value).getTime() > Date.now()) fail('时间不能晚于当前时间');
}
export function pageOf(query: any) {
  return {
    page: Math.max(1, Math.min(Math.trunc(Number(query.page)) || 1, 1000000)),
    pageSize: Math.max(1, Math.min(Math.trunc(Number(query.pageSize)) || 50, 100)),
  };
}
export function dayRange(query: any, fallback = false) {
  const today = new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const startDate =
    query.startDate ||
    (fallback
      ? new Date(Date.parse(`${today}T00:00:00+08:00`) - 29 * 86400000 + 28800000)
          .toISOString()
          .slice(0, 10)
      : undefined);
  const endDate = query.endDate || (fallback ? today : undefined);
  for (const s of [startDate, endDate])
    if (
      s &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        !Number.isFinite(Date.parse(s)) ||
        new Date(s).toISOString().slice(0, 10) !== s)
    )
      fail('日期格式错误');
  if (startDate && endDate && startDate > endDate) fail('开始日期不能晚于结束日期');
  return {
    start: startDate ? new Date(`${startDate}T00:00:00+08:00`).toISOString() : undefined,
    end: endDate
      ? new Date(Date.parse(`${endDate}T00:00:00+08:00`) + 86400000).toISOString()
      : undefined,
    startDate,
    endDate,
  };
}
