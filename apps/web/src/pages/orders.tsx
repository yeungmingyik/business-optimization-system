import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  ClipboardList,
  CreditCard,
  Plus,
  RotateCcw,
  Trash2,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import { api, patch, post, queryClient, queryString } from '../lib/api';
import { useListState, useUsers } from '../lib/hooks';
import { useSession } from '../lib/session';
import {
  cents,
  date,
  decimal,
  iso,
  localDateTime,
  money,
  today,
  useDirtyGuard,
} from '../lib/utils';
import {
  ORDER_STATUSES,
  ORDER_TYPES,
  type Customer,
  type Order,
  type OrderLine,
  type Page,
  type Product,
  type Shipment,
} from '../lib/types';
import {
  Badge,
  Button,
  ConflictActions,
  DataTable,
  DetailList,
  ErrorMessage,
  Field,
  Input,
  Loading,
  Modal,
  PageHeading,
  Pagination,
  SearchInput,
  Section,
  Select,
} from '../components/ui';
import { ExportButton, ImportDialog } from '../components/transfers';
import { EntitySelect } from '../components/entity-select';
import { WaybillAttachments } from '../components/waybill-attachments';
import { calculateOrderAmounts } from '../lib/order-amounts';

export default function Orders() {
  const requestedPath = useLocation().pathname;
  const path = useDeferredValue(requestedPath);
  if (path !== requestedPath) return <Loading rows={8} />;
  if (path === '/orders/new') return <OrderEditor />;
  const match = path.match(/^\/orders\/([^/]+)(\/edit)?$/);
  if (match)
    return match[2] ? (
      <OrderEditor key={match[1]} id={match[1]} />
    ) : (
      <OrderDetail key={match[1]} id={match[1]} />
    );
  return <OrderList />;
}

function OrderList() {
  const { user } = useSession();
  const list = useListState({ dateField: 'orderDate' });
  const users = useUsers();
  const [importOpen, setImportOpen] = useState(false);
  const [more, setMore] = useState(
    Boolean(
      list.filters.startDate ||
      list.filters.endDate ||
      list.filters.invoiceRequired ||
      list.filters.archived ||
      list.filters.dateField !== 'orderDate',
    ),
  );
  const query = useQuery({
    queryKey: ['orders', list.params],
    queryFn: ({ signal }) => api<Page<Order>>(`/orders?${queryString(list.params)}`, { signal }),
  });
  return (
    <>
      <PageHeading
        title="订单管理"
        count={query.data?.total}
        actions={
          <>
            <ExportButton kind="orders" filters={list.params} />
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              导入
            </Button>
            <Link to="/orders/new" className="button button-primary">
              <Plus size={16} />
              新增订单
            </Link>
          </>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput
            label="搜索编号、收货人、物流单号"
            value={list.search}
            onChange={list.setSearch}
          />
          <Select
            aria-label="订单状态"
            value={list.filters.status || ''}
            onChange={(event) => list.filter('status', event.target.value)}
          >
            <option value="">全部状态</option>
            {ORDER_STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Select
            aria-label="订单类型"
            value={list.filters.type || ''}
            onChange={(event) => list.filter('type', event.target.value)}
          >
            <option value="">全部类型</option>
            {ORDER_TYPES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          {user.role === 'BOSS' && (
            <Select
              aria-label="负责人"
              value={list.filters.ownerId || ''}
              onChange={(event) => list.filter('ownerId', event.target.value)}
            >
              <option value="">全部负责人</option>
              {users.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </Select>
          )}
          <Button variant={more ? 'primary' : 'outline'} onClick={() => setMore(!more)}>
            筛选
          </Button>
        </div>
        {more && (
          <div className="extended-filters">
            <Select
              aria-label="日期类型"
              value={list.filters.dateField}
              onChange={(event) => list.filter('dateField', event.target.value)}
            >
              <option value="orderDate">下单日期</option>
              <option value="createdAt">提交日期</option>
              <option value="paidAt">付款日期</option>
            </Select>
            <div className="date-range">
              <Input
                type="date"
                aria-label="开始日期"
                value={list.filters.startDate || ''}
                onChange={(event) => list.filter('startDate', event.target.value)}
              />
              <span>—</span>
              <Input
                type="date"
                aria-label="结束日期"
                value={list.filters.endDate || ''}
                onChange={(event) => list.filter('endDate', event.target.value)}
              />
            </div>
            <Select
              aria-label="是否开票"
              value={list.filters.invoiceRequired || ''}
              onChange={(event) => list.filter('invoiceRequired', event.target.value)}
            >
              <option value="">全部开票需求</option>
              <option value="true">需开票</option>
              <option value="false">不需开票</option>
            </Select>
            <Select
              aria-label="客户归档状态"
              value={list.filters.archived || ''}
              onChange={(event) => list.filter('archived', event.target.value)}
            >
              <option value="">未归档客户</option>
              <option value="true">已归档客户</option>
              <option value="all">全部客户</option>
            </Select>
            <Button variant="ghost" onClick={list.reset}>
              清除筛选
            </Button>
          </div>
        )}
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'createdAt',
              header: '提交时间',
              cell: ({ row }) => date(row.original.createdAt, true),
            },
            {
              accessorKey: 'orderNo',
              header: '订单编号',
              cell: ({ row }) => (
                <Link to={`/orders/${row.original.id}`} className="text-link tabular">
                  {row.original.orderNo}
                </Link>
              ),
            },
            { accessorKey: 'orderDate', header: '下单日期' },
            {
              accessorKey: 'recipientName',
              header: '收货人',
              cell: ({ row }) => (
                <div>
                  <span className="cell-strong">{row.original.recipientName}</span>
                  <small className="cell-secondary">{row.original.customerName}</small>
                </div>
              ),
            },
            { accessorKey: 'recipientPhone', header: '联系方式' },
            {
              accessorKey: 'invoiceRequired',
              header: '是否开票',
              cell: ({ row }) => (row.original.invoiceRequired ? '是' : '否'),
            },
            {
              accessorKey: 'totalInclTax',
              header: '含税总计（元）',
              cell: ({ row }) => (
                <strong className="amount">{money(row.original.totalInclTax)}</strong>
              ),
            },
            { accessorKey: 'type', header: '订单类型' },
            {
              accessorKey: 'status',
              header: '订单状态',
              cell: ({ row }) => <Badge>{row.original.status}</Badge>,
            },
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <Link to={`/orders/${row.original.id}`} className="button button-ghost button-sm">
                  查看
                </Link>
              ),
            },
          ]}
          emptyAction={
            <Link to="/orders/new" className="button button-outline button-sm">
              <Plus size={14} />
              新增订单
            </Link>
          }
        />
        <Pagination
          total={query.data?.total || 0}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>
      {importOpen && <ImportDialog kind="orders" open onOpenChange={setImportOpen} />}
    </>
  );
}

function OrderDetail({ id }: { id: string }) {
  const { user } = useSession();
  const query = useQuery({
    queryKey: ['order', id],
    queryFn: ({ signal }) => api<Order>(`/orders/${id}`, { signal }),
  });
  const [action, setAction] = useState<'payment' | 'cancel' | 'payment-correction' | null>(null);
  const payments = useQuery({
    queryKey: ['payments', id],
    queryFn: () =>
      api<
        {
          id: string;
          paidAt: string;
          amount: string;
          paymentNote?: string;
          receivingAccount?: string;
          previousValue?: { receivingAccount?: string };
          previousStatus: Order['status'];
          nextStatus: Order['status'];
          actorName: string;
          reason?: string;
          createdAt: string;
        }[]
      >(`/orders/${id}/payments`),
  });
  if (query.isPending) return <Loading rows={7} />;
  if (query.error || !query.data)
    return (
      <>
        <Link to="/orders" className="back-link">
          <ArrowLeft size={16} />
          订单管理
        </Link>
        <ErrorMessage error={query.error || '记录不可用'} />
      </>
    );
  const item = query.data;
  return (
    <>
      <Link to="/orders" className="back-link">
        <ArrowLeft size={16} />
        订单管理
      </Link>
      <PageHeading
        title={item.orderNo}
        actions={
          <>
            {item.status === '待付款' && (
              <>
                <Button onClick={() => setAction('cancel')}>取消付款</Button>
                <Button variant="primary" onClick={() => setAction('payment')}>
                  <CreditCard size={16} />
                  登记付款
                </Button>
              </>
            )}
            {item.status === '已付款' && user.role === 'BOSS' && (
              <Button onClick={() => setAction('payment-correction')}>更正付款</Button>
            )}
            {item.status !== '取消付款' && (
              <Link to={`/orders/${id}/edit`} className="button button-outline">
                编辑订单
              </Link>
            )}
          </>
        }
      >
        <div className="page-subline">
          <Badge>{item.status}</Badge>
          <span>{item.type}订单</span>
          <span>{date(item.createdAt, true)}</span>
        </div>
      </PageHeading>
      <div className="order-layout">
        <div className="order-main">
          <Section title="客户与订单">
            <DetailList
              values={[
                [
                  '关联客户',
                  <Link to={`/customers?customer=${item.customerId}`} className="text-link">
                    {item.customerName || item.customerNo}
                  </Link>,
                ],
                ['下单日期', item.orderDate],
                ['负责人', item.ownerName],
                ['是否开票', item.invoiceRequired ? '是' : '否'],
                ['外部来源', item.externalSource],
                ['外部原单号', item.externalOrderNo],
                [
                  '原订单',
                  item.originalOrderId ? (
                    <Link to={`/orders/${item.originalOrderId}`} className="text-link">
                      查看原订单
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
              ]}
            />
          </Section>
          <Section title="收货信息">
            <DetailList
              values={[
                ['收货人', item.recipientName],
                ['联系方式', item.recipientPhone],
                ['收货地址', item.recipientAddress],
              ]}
            />
          </Section>
          <Section title="产品明细">
            <OrderDetailLines lines={item.lines} />
          </Section>
          <Section title="物流信息" action={<Truck size={17} />}>
            {item.shipments.length ? (
              <div className="shipment-cards">
                {item.shipments.map((shipment, i) => (
                  <div key={shipment.id || i}>
                    <span className="shipment-number">{i + 1}</span>
                    <DetailList
                      values={[
                        ['物流公司', shipment.carrier],
                        ['运费要求', shipment.freightPayment],
                        ['物流单号', shipment.trackingNo],
                      ]}
                    />
                    {!!shipment.attachmentIds?.length && (
                      <WaybillAttachments
                        value={shipment.attachmentIds}
                        onChange={() => undefined}
                        disabled
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="section-empty">暂无物流记录</div>
            )}
          </Section>
          <Section title="付款记录">
            <ErrorMessage error={payments.error} />
            {payments.data?.length ? (
              payments.data.map((payment, index) => (
                <div className="payment-record" key={payment.id || index}>
                  <span className="overview-icon icon-green">
                    <CreditCard size={17} />
                  </span>
                  <div>
                    <strong>
                      {payment.previousStatus === '已付款'
                        ? '更正付款'
                        : payment.nextStatus === '取消付款'
                          ? '取消付款'
                          : '登记付款'}{' '}
                      · ¥ {money(payment.amount)}
                    </strong>
                    <small>
                      {payment.actorName} · {date(payment.createdAt, true)}
                      {payment.paymentNote ? ` · ${payment.paymentNote}` : ''}
                    </small>
                    {payment.paidAt && <small>付款时间 {date(payment.paidAt, true)}</small>}
                    {payment.receivingAccount && <small>收款账号 {payment.receivingAccount}</small>}
                    {payment.previousValue?.receivingAccount &&
                      payment.previousValue.receivingAccount !== payment.receivingAccount && (
                        <small>原收款账号 {payment.previousValue.receivingAccount}</small>
                      )}
                    {payment.reason && <small>原因：{payment.reason}</small>}
                  </div>
                  <Badge>{payment.nextStatus}</Badge>
                </div>
              ))
            ) : (
              <div className="section-empty">暂无付款记录</div>
            )}
          </Section>
          {item.cancelReason && (
            <Section title="取消原因">
              <p className="business-note">{item.cancelReason}</p>
            </Section>
          )}
          {item.note && (
            <Section title="备注">
              <p className="business-note">{item.note}</p>
            </Section>
          )}
        </div>
        <aside className="order-summary">
          <AmountSummary
            goods={item.goodsTotal}
            freight={item.freightFee}
            packaging={item.packagingFee}
            tax={item.taxFee}
            taxRate={item.taxRate}
            total={item.totalInclTax}
            subtotal={item.totalExTax}
            calculatedTotal={item.calculatedTotalInclTax}
            adjusted={item.totalInclTaxOverride != null}
          />
          {item.paidAt && (
            <div className="panel paid-summary">
              <span>
                <Check size={16} />
                已付款
              </span>
              <strong>¥ {money(item.totalInclTax)}</strong>
              <small>{date(item.paidAt, true)}</small>
              {item.receivingAccount && <small>收款账号 {item.receivingAccount}</small>}
            </div>
          )}
        </aside>
      </div>
      {action && <PaymentDialog order={item} action={action} onClose={() => setAction(null)} />}
    </>
  );
}

const OrderDetailLines = memo(function OrderDetailLines({ lines }: { lines: OrderLine[] }) {
  return (
    <DataTable
      data={lines}
      columns={[
        {
          accessorKey: 'name',
          header: '产品',
          cell: ({ row }) => (
            <div>
              <strong>{row.original.name}</strong>
              <small className="cell-secondary">
                {row.original.sku} · {row.original.model || '—'}
              </small>
            </div>
          ),
        },
        { accessorKey: 'unit', header: '单位' },
        { accessorKey: 'quantity', header: '数量' },
        {
          accessorKey: 'unitPriceExTax',
          header: '不含税单价（元）',
          cell: ({ row }) => money(row.original.unitPriceExTax),
        },
        {
          accessorKey: 'lineTotal',
          header: '金额（元）',
          cell: ({ row }) => money(row.original.lineTotal),
        },
      ]}
    />
  );
});

type EditorLine = OrderLine & { rowId: string };
type EditorShipment = Shipment & { rowId: string };
function newLine(): EditorLine {
  return {
    rowId: crypto.randomUUID(),
    productId: '',
    quantity: 1,
    unitPriceExTax: '0.00',
    model: '',
  };
}

function orderForm(item?: Order) {
  if (item)
    return {
      customerId: item.customerId,
      orderDate: item.orderDate,
      recipientName: item.recipientName,
      recipientPhone: item.recipientPhone,
      recipientAddress: item.recipientAddress,
      invoiceRequired: item.invoiceRequired,
      note: item.note || '',
      type: item.type,
      originalOrderId: item.originalOrderId || '',
      externalSource: item.externalSource || '',
      externalOrderNo: item.externalOrderNo || '',
      freightFee: item.freightFee,
      packagingFee: item.packagingFee,
      taxFee: item.taxFee,
      taxRate: item.taxRate || '0',
      taxFeeMode: item.taxFeeMode || 'manual',
      totalInclTaxOverride: item.totalInclTaxOverride ?? null,
    };
  return {
    customerId: new URLSearchParams(window.location.search).get('customerId') || '',
    orderDate: today(),
    recipientName: '',
    recipientPhone: '',
    recipientAddress: '',
    invoiceRequired: false,
    note: '',
    type: '正常' as Order['type'],
    originalOrderId: '',
    externalSource: '',
    externalOrderNo: '',
    freightFee: '0.00',
    packagingFee: '0.00',
    taxFee: '0.00',
    taxRate: '0',
    taxFeeMode: 'auto' as 'auto' | 'manual',
    totalInclTaxOverride: null as string | null,
  };
}

function OrderEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<Order>(`/orders/${id}`),
    enabled: !!id,
  });
  const initializedOrder = useRef(query.data);
  const [form, setForm] = useState(() => orderForm(query.data));
  const customer = useQuery({
    queryKey: ['order-customer', form.customerId],
    queryFn: ({ signal }) => api<Customer>(`/customers/${form.customerId}`, { signal }),
    enabled: !!form.customerId && !id,
  });
  const [lines, setLines] = useState<EditorLine[]>(() =>
    query.data
      ? query.data.lines.map((line) => ({ ...line, rowId: crypto.randomUUID() }))
      : [newLine()],
  );
  const lineRef = useRef(lines);
  lineRef.current = lines;
  const [shipments, setShipments] = useState<EditorShipment[]>(
    () =>
      query.data?.shipments.map((shipment) => ({ ...shipment, rowId: crypto.randomUUID() })) || [],
  );
  const [busyWaybills, setBusyWaybills] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<{ line: EditorLine; index: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const updateLine = useCallback((line: EditorLine) => {
    setDirty(true);
    setLines((current) =>
      current.map((existing) => (existing.rowId === line.rowId ? line : existing)),
    );
  }, []);
  const removeLine = useCallback((rowId: string) => {
    const index = lineRef.current.findIndex((line) => line.rowId === rowId);
    if (index < 0) return;
    setDirty(true);
    setRemoved({ line: lineRef.current[index], index });
    setLines((current) => current.filter((line) => line.rowId !== rowId));
  }, []);
  useDirtyGuard(dirty);
  const locked = query.data?.status === '已付款';
  useEffect(() => {
    if (query.data && query.data !== initializedOrder.current) {
      const item = query.data;
      initializedOrder.current = item;
      setForm(orderForm(item));
      setLines(item.lines.map((line) => ({ ...line, rowId: crypto.randomUUID() })));
      setShipments(item.shipments.map((shipment) => ({ ...shipment, rowId: crypto.randomUUID() })));
    }
  }, [query.data]);
  useEffect(() => {
    if (!id && !form.recipientName && customer.data) {
      const selected = customer.data;
      setForm((current) => ({
        ...current,
        recipientName: selected.contactName,
        recipientPhone: selected.contactPhone || selected.companyPhone || '',
        recipientAddress: selected.deliveryAddress || selected.companyAddress || '',
      }));
    }
  }, [customer.data, form.recipientName, id]);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }
  function selectCustomer(selected: Customer) {
    setDirty(true);
    setForm((current) => ({
      ...current,
      customerId: selected.id,
      recipientName: selected.contactName,
      recipientPhone: selected.contactPhone || selected.companyPhone || '',
      recipientAddress: selected.deliveryAddress || selected.companyAddress || '',
    }));
  }
  const totals = useMemo(() => calculateOrderAmounts(lines, form), [lines, form]);
  const save = useMutation({
    mutationFn: () => {
      const shipping = shipments.map(({ rowId: _rowId, ...shipment }) => shipment);
      const data = locked
        ? {
            recipientName: form.recipientName,
            recipientPhone: form.recipientPhone,
            recipientAddress: form.recipientAddress,
            invoiceRequired: form.invoiceRequired,
            note: form.note,
            shipments: shipping,
          }
        : {
            ...form,
            taxFee: form.taxFeeMode === 'auto' ? totals.tax : form.taxFee,
            originalOrderId: form.originalOrderId || null,
            shipments: shipping,
            lines: lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPriceExTax: line.unitPriceExTax,
              model: line.model,
            })),
          };
      return id
        ? patch<Order>(`/orders/${id}`, { ...data, version: query.data?.version })
        : post<Order>('/orders', data);
    },
    onSuccess: (result) => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void navigate({ to: `/orders/${result.id || id}`, ignoreBlocker: true });
    },
  });
  function cancel() {
    if (!dirty || confirm('有未保存的修改，确认离开？')) {
      setDirty(false);
      void navigate({ to: id ? `/orders/${id}` : '/orders', ignoreBlocker: true });
    }
  }
  if (id && query.isPending) return <Loading rows={8} />;
  if (query.error || query.data?.status === '取消付款')
    return (
      <>
        <Link to="/orders" className="back-link">
          <ArrowLeft size={16} />
          订单管理
        </Link>
        <ErrorMessage error={query.error || '取消付款订单不可修改'} />
      </>
    );
  return (
    <>
      <button className="back-link text-button" onClick={cancel}>
        <ArrowLeft size={16} />
        订单管理
      </button>
      <PageHeading title={id ? `编辑 ${query.data?.orderNo || '订单'}` : '新增订单'}>
        <div className="page-subline">
          {query.data && <Badge>{query.data.status}</Badge>}
          <span>{save.isPending ? '保存中' : dirty ? '未保存' : ''}</span>
        </div>
      </PageHeading>
      <form
        id="order-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busyWaybills.size || save.isPending) return;
          save.mutate();
        }}
      >
        <ErrorMessage error={save.error} />
        <ConflictActions
          error={save.error}
          onReload={() => {
            setDirty(false);
            save.reset();
            void query.refetch();
          }}
          onKeep={() => save.reset()}
        />
        <div className="order-layout">
          <div className="order-main">
            <Section title="客户与订单" action={<ClipboardList size={18} />}>
              <div className="form-grid">
                <Field label="关联客户" required className="span-two">
                  <EntitySelect
                    resource="customers"
                    label="关联客户"
                    required
                    value={form.customerId}
                    disabled={locked}
                    onChange={(value) => update('customerId', value)}
                    onSelect={selectCustomer}
                  />
                </Field>
                <Field label="下单日期" required>
                  <Input
                    type="date"
                    value={form.orderDate}
                    required
                    disabled={locked}
                    onChange={(event) => update('orderDate', event.target.value)}
                  />
                </Field>
                <Field label="订单类型" required>
                  <Select
                    value={form.type}
                    disabled={locked}
                    onChange={(event) => update('type', event.target.value as Order['type'])}
                  >
                    {ORDER_TYPES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </Select>
                </Field>
                {form.type !== '正常' && (
                  <Field label="原订单" className="span-two">
                    <EntitySelect
                      resource="orders"
                      label="原订单"
                      value={form.originalOrderId}
                      disabled={locked}
                      filters={{ archived: 'all' }}
                      onChange={(value) => update('originalOrderId', value)}
                    />
                  </Field>
                )}
                <Field label="外部来源">
                  <Input
                    value={form.externalSource}
                    disabled={locked}
                    maxLength={100}
                    onChange={(event) => update('externalSource', event.target.value)}
                  />
                </Field>
                <Field label="外部原单号">
                  <Input
                    value={form.externalOrderNo}
                    disabled={locked}
                    maxLength={200}
                    onChange={(event) => update('externalOrderNo', event.target.value)}
                  />
                </Field>
              </div>
            </Section>
            <Section title="收货与开票">
              <div className="form-grid">
                <Field label="收货人" required>
                  <Input
                    required
                    maxLength={100}
                    value={form.recipientName}
                    onChange={(event) => update('recipientName', event.target.value)}
                  />
                </Field>
                <Field label="联系方式" required>
                  <Input
                    required
                    maxLength={100}
                    value={form.recipientPhone}
                    onChange={(event) => update('recipientPhone', event.target.value)}
                  />
                </Field>
                <Field label="收货地址" required className="span-two">
                  <Input
                    required
                    maxLength={500}
                    value={form.recipientAddress}
                    onChange={(event) => update('recipientAddress', event.target.value)}
                  />
                </Field>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={form.invoiceRequired}
                    onChange={(event) => update('invoiceRequired', event.target.checked)}
                  />
                  需要开票
                </label>
              </div>
            </Section>
            <Section
              title="产品明细"
              action={
                !locked && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDirty(true);
                      setLines((current) => [...current, newLine()]);
                      setTimeout(
                        () =>
                          document
                            .querySelector<HTMLButtonElement>(
                              '.order-lines tbody tr:last-child .entity-select-trigger',
                            )
                            ?.focus(),
                        0,
                      );
                    }}
                  >
                    <Plus size={14} />
                    添加产品
                  </Button>
                )
              }
            >
              <div className="table-scroll order-lines">
                <table>
                  <thead>
                    <tr>
                      <th>产品</th>
                      <th>规格型号</th>
                      <th>数量</th>
                      <th>不含税单价（元）</th>
                      <th>金额（元）</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <OrderLineRow
                        key={line.rowId}
                        line={line}
                        disabled={!!locked}
                        onChange={updateLine}
                        onRemove={removeLine}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {removed && (
                <div className="undo-row">
                  已移除 {removed.line.name || '产品明细'}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setLines((current) => [
                        ...current.slice(0, removed.index),
                        removed.line,
                        ...current.slice(removed.index),
                      ]);
                      setRemoved(null);
                    }}
                  >
                    <RotateCcw size={13} />
                    撤销
                  </Button>
                </div>
              )}
              {!lines.length && <ErrorMessage error="至少添加一项产品明细" />}
            </Section>
            <Section title="费用明细">
              <div className="form-grid">
                {(
                  [
                    ['freightFee', '运费（元）'],
                    ['packagingFee', '包装费（元）'],
                  ] as const
                ).map(([key, label]) => (
                  <Field label={label} required key={key}>
                    <Input
                      inputMode="decimal"
                      pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                      required
                      disabled={locked}
                      value={form[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  </Field>
                ))}
                <Field label="税率（%）" required>
                  <Input
                    inputMode="decimal"
                    pattern="(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)"
                    maxLength={8}
                    required
                    disabled={locked}
                    value={form.taxRate}
                    onChange={(event) => update('taxRate', event.target.value)}
                  />
                </Field>
                <div className="amount-field">
                  <Field label="税费（元）" required>
                    <Input
                      inputMode="decimal"
                      pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                      required
                      disabled={locked}
                      value={form.taxFeeMode === 'auto' ? totals.tax : form.taxFee}
                      onChange={(event) => {
                        setDirty(true);
                        setForm((current) => ({
                          ...current,
                          taxFeeMode: 'manual',
                          taxFee: event.target.value,
                        }));
                      }}
                    />
                  </Field>
                  <div className="amount-field-meta">
                    <span>{form.taxFeeMode === 'auto' ? '自动计算' : '手动金额'}</span>
                    {form.taxFeeMode === 'manual' && !locked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="恢复税费自动计算"
                        onClick={() => update('taxFeeMode', 'auto')}
                      >
                        <RotateCcw size={13} />
                        恢复计算
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Section>
            <Section
              title="物流信息"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setDirty(true);
                    setShipments((current) => [
                      ...current,
                      {
                        rowId: crypto.randomUUID(),
                        carrier: '',
                        freightPayment: '到付',
                        trackingNo: '',
                        attachmentIds: [],
                      },
                    ]);
                  }}
                >
                  <Plus size={14} />
                  添加物流
                </Button>
              }
            >
              <div className="shipment-form-list">
                {shipments.map((shipment, index) => (
                  <div className="shipment-form" key={shipment.rowId}>
                    <span className="shipment-number">{index + 1}</span>
                    <Field label="物流公司" required={!shipment.attachmentIds?.length}>
                      <Input
                        required={!shipment.attachmentIds?.length}
                        maxLength={200}
                        value={shipment.carrier}
                        onChange={(event) => {
                          setDirty(true);
                          setShipments((current) =>
                            current.map((item) =>
                              item.rowId === shipment.rowId
                                ? { ...item, carrier: event.target.value }
                                : item,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <Field label="运费要求">
                      <Select
                        value={shipment.freightPayment}
                        onChange={(event) => {
                          setDirty(true);
                          setShipments((current) =>
                            current.map((item) =>
                              item.rowId === shipment.rowId
                                ? {
                                    ...item,
                                    freightPayment: event.target
                                      .value as Shipment['freightPayment'],
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <option>到付</option>
                        <option>现付</option>
                      </Select>
                    </Field>
                    <Field label="物流单号" required={!shipment.attachmentIds?.length}>
                      <Input
                        required={!shipment.attachmentIds?.length}
                        maxLength={200}
                        value={shipment.trackingNo}
                        onChange={(event) => {
                          setDirty(true);
                          setShipments((current) =>
                            current.map((item) =>
                              item.rowId === shipment.rowId
                                ? { ...item, trackingNo: event.target.value }
                                : item,
                            ),
                          );
                        }}
                      />
                    </Field>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`移除物流 ${index + 1}`}
                      disabled={busyWaybills.has(shipment.rowId) || save.isPending}
                      onClick={() => {
                        setDirty(true);
                        setShipments((current) =>
                          current.filter((item) => item.rowId !== shipment.rowId),
                        );
                      }}
                    >
                      <X size={16} />
                    </Button>
                    <div className="shipment-attachments">
                      <WaybillAttachments
                        value={shipment.attachmentIds || []}
                        disabled={save.isPending}
                        onBusyChange={(busy) => {
                          setBusyWaybills((current) => {
                            const next = new Set(current);
                            if (busy) next.add(shipment.rowId);
                            else next.delete(shipment.rowId);
                            return next;
                          });
                        }}
                        onChange={(attachmentIds) => {
                          setDirty(true);
                          setShipments((current) =>
                            current.map((item) =>
                              item.rowId === shipment.rowId ? { ...item, attachmentIds } : item,
                            ),
                          );
                        }}
                        onRecognized={(result) => {
                          setDirty(true);
                          setShipments((current) =>
                            current.map((item) =>
                              item.rowId === shipment.rowId
                                ? {
                                    ...item,
                                    carrier: result.carrier || item.carrier,
                                    trackingNo: result.trackingNo || item.trackingNo,
                                  }
                                : item,
                            ),
                          );
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="备注">
              <textarea
                className="input"
                rows={3}
                maxLength={5000}
                aria-label="订单备注"
                value={form.note}
                onChange={(event) => update('note', event.target.value)}
              />
            </Section>
          </div>
          <aside className="order-summary">
            <AmountSummary
              goods={totals.goods}
              freight={form.freightFee}
              packaging={form.packagingFee}
              tax={totals.tax}
              taxRate={form.taxRate}
              subtotal={totals.subtotal}
              total={totals.total}
              calculatedTotal={totals.calculatedTotal}
              adjusted={form.totalInclTaxOverride !== null}
              editable={!locked}
              onTotalChange={(value) => update('totalInclTaxOverride', value)}
              totalInput={form.totalInclTaxOverride ?? totals.total}
            />
          </aside>
        </div>
        <div className="editor-footer">
          <span className="save-status">{save.isPending ? '保存中' : dirty ? '未保存' : ''}</span>
          <span className="footer-amount">
            含税总计 <strong>¥ {money(totals.total)}</strong>
          </span>
          <Button onClick={cancel}>取消</Button>
          <Button
            variant="primary"
            type="submit"
            pending={save.isPending}
            disabled={!lines.length || busyWaybills.size > 0}
          >
            保存订单
          </Button>
        </div>
      </form>
    </>
  );
}

const OrderLineRow = memo(function OrderLineRow({
  line,
  disabled,
  onChange,
  onRemove,
}: {
  line: EditorLine;
  disabled: boolean;
  onChange: (line: EditorLine) => void;
  onRemove: (rowId: string) => void;
}) {
  return (
    <tr>
      <td>
        <EntitySelect
          resource="products"
          label="明细产品"
          value={line.productId}
          required
          disabled={disabled}
          selectedOptions={
            line.productId ? [{ id: line.productId, name: line.name, sku: line.sku }] : []
          }
          onChange={(value) => onChange({ ...line, productId: value })}
          onSelect={(product: Product) =>
            onChange({
              ...line,
              productId: product.id,
              name: product.name,
              sku: product.sku,
              unitPriceExTax: product.priceExTax,
              model: product.model || '',
              unit: product.unit,
            })
          }
        />
        {line.unit && <small className="cell-secondary">单位：{line.unit}</small>}
      </td>
      <td>
        <Input
          aria-label="规格型号"
          value={line.model}
          disabled={disabled}
          onChange={(event) => onChange({ ...line, model: event.target.value })}
        />
      </td>
      <td>
        <Input
          aria-label="数量"
          type="number"
          min={1}
          max={999999}
          step={1}
          required
          value={line.quantity || ''}
          disabled={disabled}
          onChange={(event) => onChange({ ...line, quantity: Number(event.target.value) })}
        />
      </td>
      <td>
        <Input
          aria-label="不含税单价"
          inputMode="decimal"
          pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
          required
          disabled={disabled}
          value={line.unitPriceExTax}
          onChange={(event) => onChange({ ...line, unitPriceExTax: event.target.value })}
        />
      </td>
      <td className="amount">
        {money(
          decimal(
            cents(line.unitPriceExTax) *
              BigInt(Number.isInteger(line.quantity) && line.quantity > 0 ? line.quantity : 0),
          ),
        )}
      </td>
      <td>
        {!disabled && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="移除产品"
            onClick={() => onRemove(line.rowId)}
          >
            <Trash2 size={15} />
          </Button>
        )}
      </td>
    </tr>
  );
});

function AmountSummary({
  goods,
  freight,
  packaging,
  tax,
  subtotal,
  total,
  taxRate,
  calculatedTotal,
  adjusted = false,
  editable = false,
  onTotalChange,
  totalInput,
}: {
  goods: string;
  freight: string;
  packaging: string;
  tax: string;
  subtotal: string;
  total: string;
  taxRate?: string;
  calculatedTotal?: string;
  adjusted?: boolean;
  editable?: boolean;
  onTotalChange?: (value: string | null) => void;
  totalInput?: string;
}) {
  return (
    <Section title="金额汇总">
      <dl className="amount-breakdown">
        <div>
          <dt>商品总金额</dt>
          <dd>¥ {money(goods)}</dd>
        </div>
        <div>
          <dt>运费</dt>
          <dd>¥ {money(freight)}</dd>
        </div>
        <div>
          <dt>包装费</dt>
          <dd>¥ {money(packaging)}</dd>
        </div>
        <div className="subtotal">
          <dt>不含税总计</dt>
          <dd>¥ {money(subtotal)}</dd>
        </div>
        <div>
          <dt>税费{taxRate ? `（${taxRate}%）` : ''}</dt>
          <dd>¥ {money(tax)}</dd>
        </div>
        {adjusted && calculatedTotal && (
          <div>
            <dt>计算金额</dt>
            <dd>¥ {money(calculatedTotal)}</dd>
          </div>
        )}
        <div className={`grand-total ${editable ? 'editable-total' : ''}`}>
          <dt>含税总计</dt>
          <dd>
            {editable ? (
              <Input
                aria-label="含税总计（元）"
                inputMode="decimal"
                pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                required
                value={totalInput ?? total}
                onChange={(event) => onTotalChange?.(event.target.value)}
              />
            ) : (
              <>
                <small>¥</small> {money(total)}
              </>
            )}
          </dd>
        </div>
      </dl>
      {editable && (
        <div className="amount-field-meta">
          <span>{adjusted ? '手动金额' : '自动计算'}</span>
          {adjusted && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="恢复含税总计自动计算"
              onClick={() => onTotalChange?.(null)}
            >
              <RotateCcw size={13} />
              恢复计算
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function PaymentDialog({
  order,
  action,
  onClose,
}: {
  order: Order;
  action: 'payment' | 'cancel' | 'payment-correction';
  onClose: () => void;
}) {
  const [paidAt, setPaidAt] = useState(localDateTime(order.paidAt));
  const [paymentNote, setPaymentNote] = useState(order.paymentNote || '');
  const [receivingAccount, setReceivingAccount] = useState(order.receivingAccount || '');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('已付款');
  const mutation = useMutation({
    mutationFn: () =>
      post(`/orders/${order.id}/${action}`, {
        version: order.version,
        ...(action === 'cancel'
          ? { reason }
          : action === 'payment-correction'
            ? {
                status,
                paidAt: status === '已付款' ? iso(paidAt) : null,
                paymentNote,
                receivingAccount,
                reason,
              }
            : { paidAt: iso(paidAt), paymentNote, receivingAccount }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['payments', order.id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={action === 'payment' ? '登记付款' : action === 'cancel' ? '取消付款' : '更正付款'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant={action === 'cancel' ? 'danger' : 'primary'}
            form="payment-form"
            type="submit"
            pending={mutation.isPending}
          >
            确认
          </Button>
        </>
      }
    >
      <form
        id="payment-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="payment-amount">
          <span>{order.orderNo}</span>
          <strong>¥ {money(order.totalInclTax)}</strong>
        </div>
        {action === 'payment-correction' && (
          <Field label="更正后状态" required>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>已付款</option>
              <option>待付款</option>
            </Select>
          </Field>
        )}
        {action !== 'cancel' && status === '已付款' && (
          <>
            <Field label="付款时间" required>
              <Input
                type="datetime-local"
                value={paidAt}
                max={localDateTime()}
                required
                onChange={(event) => setPaidAt(event.target.value)}
              />
            </Field>
            <Field label="收款账号" required>
              <Input
                value={receivingAccount}
                maxLength={200}
                required
                onChange={(event) => setReceivingAccount(event.target.value)}
              />
            </Field>
            <Field label="付款备注">
              <textarea
                className="input"
                rows={2}
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
              />
            </Field>
          </>
        )}
        {action !== 'payment' && (
          <Field label={action === 'cancel' ? '取消原因' : '更正原因'} required>
            <textarea
              className="input"
              rows={3}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
        <ErrorMessage error={mutation.error} />
      </form>
    </Modal>
  );
}
