export type TransferKind = 'customers' | 'products' | 'orders';

export type TransferActor = { id: string; role: 'BOSS' | 'OPERATOR'; displayName?: string };

export type TransferError = { row: number; field: string; message: string };

export type SpreadsheetRow = { row: number; values: Record<string, string> };

export type SpreadsheetResult = {
  rows: SpreadsheetRow[];
  errors: TransferError[];
  rowCount: number;
};

export type TransferRecord = {
  id: string;
  job_type: 'IMPORT' | 'EXPORT';
  kind: TransferKind;
  actor_id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  phase: 'PREVIEW' | 'COMMIT' | 'EXPORT';
  storage_key: string | null;
  file_hash: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string | null;
  committed_at: Date | null;
};

export const importColumns: Record<TransferKind, Record<string, string>> = {
  customers: {
    companyName: '所属公司',
    contactName: '联系人',
    contactPhone: '联系电话',
    deliveryAddress: '收货地址',
    companyTaxId: '税号',
    companyPhone: '公司电话',
    companyAddress: '公司地址',
    bankName: '开户行',
    bankAccount: '银行账号',
    taobaoId: '淘宝号',
    wechatId: '微信号',
    wechatName: '微信名称',
    douyinId: '抖音号',
    merchantAccountNames: '所属账号',
    sourceChannel: '来源渠道',
    followupStatus: '跟单状态',
    productSkus: '意向产品编号',
    tags: '客户标签',
    ownerLoginName: '负责人账号',
    lastDealAt: '最近成交时间',
    nextFollowupAt: '下次跟进时间',
  },
  products: {
    sku: '产品编号',
    name: '产品名称',
    model: '规格型号',
    unit: '单位',
    priceExTax: '不含税单价',
    category: '分类',
    tags: '标签',
  },
  orders: {
    group: '订单分组',
    customerNo: '客户编号',
    orderDate: '下单日期',
    recipientName: '收货人',
    recipientPhone: '联系方式',
    recipientAddress: '收货地址',
    invoiceRequired: '是否开票',
    type: '订单类型',
    externalSource: '外部来源',
    externalOrderNo: '外部原单号',
    originalOrderNo: '原订单编号',
    freight: '运费',
    packaging: '包装费',
    tax: '税费',
    taxRate: '税率（%）',
    taxFeeMode: '税费计算方式',
    totalInclTaxOverride: '调整后含税总计',
    note: '备注',
    productSku: '产品编号',
    quantity: '数量',
    unitPriceExTax: '不含税单价',
    carrier: '物流公司',
    freightPayment: '运费要求',
    trackingNo: '物流单号',
    status: '订单状态',
    paidAt: '付款时间',
    paymentNote: '付款备注',
    receivingAccount: '收款账号',
  },
};

export const spreadsheetEnums: Record<string, string[]> = {
  sourceChannel: [
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
  ],
  followupStatus: ['待跟进', '已报价', '待付款', '已付款'],
  invoiceRequired: ['是', '否'],
  type: ['正常', '退货', '维修'],
  freightPayment: ['到付', '现付'],
  status: ['待付款', '已付款'],
  taxFeeMode: ['自动计算', '手动金额'],
};

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_VERSION = 1;
