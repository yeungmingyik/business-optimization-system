export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Entity {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}
export interface User extends Entity {
  loginName: string;
  displayName: string;
  role: 'BOSS' | 'OPERATOR';
  mustChangePassword: boolean;
  accountStatus: 'ACTIVE' | 'DISABLED';
  lastLoginAt?: string;
}
export interface Session {
  user: User;
  csrfToken: string;
}
export interface Option extends Entity {
  name: string;
  kind?: string;
  enabled?: boolean;
  platform?: string;
}
export type CustomerStatus = '待跟进' | '已报价' | '待付款' | '已付款';
export interface Customer extends Entity {
  customerNo: string;
  companyName: string;
  taxId: string;
  companyPhone: string;
  companyAddress: string;
  bankName: string;
  bankAccount: string;
  contactName: string;
  contactPhone: string;
  deliveryAddress?: string;
  taobaoId: string;
  wechatId: string;
  wechatName: string;
  douyinId: string;
  merchantAccountId: string;
  merchantAccountName: string;
  sourceChannel: string;
  status: CustomerStatus;
  ownerId: string;
  ownerName: string;
  productIds: string[];
  tagIds: string[];
  products: Product[];
  tags: Option[];
  lastDealAt: string | null;
  nextFollowupAt: string | null;
}
export interface Product extends Entity {
  sku: string;
  name: string;
  model: string;
  unit: string;
  priceExTax: string;
  categoryId: string | null;
  categoryName: string;
  tagIds: string[];
  assetIds: string[];
  tags: Option[];
}
export interface Followup extends Entity {
  content: string;
  occurredAt: string;
  contactChannel: string;
  nextFollowupAt: string | null;
  actorName: string;
}
export interface OrderLine {
  id?: string;
  productId: string;
  sku?: string;
  name?: string;
  model: string;
  unit?: string;
  quantity: number;
  unitPriceExTax: string;
  lineTotal?: string;
}
export interface Shipment {
  id?: string;
  carrier: string;
  freightPayment: '到付' | '现付';
  trackingNo: string;
  attachmentIds?: string[];
}
export interface Order extends Entity {
  orderNo: string;
  customerId: string;
  customerName: string;
  customerNo: string;
  ownerId: string;
  ownerName: string;
  orderDate: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  invoiceRequired: boolean;
  note: string;
  type: '正常' | '退货' | '维修';
  status: '待付款' | '已付款' | '取消付款';
  originalOrderId: string | null;
  externalSource: string;
  externalOrderNo: string;
  freightFee: string;
  packagingFee: string;
  taxFee: string;
  taxRate?: string;
  taxFeeMode?: 'auto' | 'manual';
  calculatedTaxFee?: string;
  calculatedTotalInclTax?: string;
  totalInclTaxOverride?: string | null;
  goodsTotal: string;
  totalExTax: string;
  totalInclTax: string;
  paidAt: string | null;
  paymentNote: string;
  receivingAccount?: string;
  cancelReason?: string;
  lines: OrderLine[];
  shipments: Shipment[];
}
export interface Summary {
  customerCount: number;
  pendingCustomerCount: number;
  todayFollowupCount: number;
  overdueFollowupCount: number;
  recentDealCustomerCount: number;
  dealAmount: string;
  dealOrderCount: number;
  pendingAmount: string;
  returnCount: number;
  returnAmount: string;
  repairCount: number;
  repairAmount: string;
}
export const CUSTOMER_STATUSES = ['待跟进', '已报价', '待付款', '已付款'] as const;
export const ORDER_STATUSES = ['待付款', '已付款', '取消付款'] as const;
export const ORDER_TYPES = ['正常', '退货', '维修'] as const;
export const CHANNELS = [
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
];
