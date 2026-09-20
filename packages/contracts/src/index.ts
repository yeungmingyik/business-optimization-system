export const roles = ['BOSS', 'OPERATOR'] as const;
export const customerStatuses = ['待跟进', '已报价', '待付款', '已付款'] as const;
export const orderStatuses = ['待付款', '已付款', '取消付款'] as const;
export const orderTypes = ['正常', '退货', '维修'] as const;
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
export type Role = (typeof roles)[number];
export interface User {
  id: string;
  loginName: string;
  displayName: string;
  role: Role;
  accountStatus: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  version: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ApiError {
  code: string;
  message: string;
  fieldErrors: Record<string, string[]>;
  requestId: string;
}
