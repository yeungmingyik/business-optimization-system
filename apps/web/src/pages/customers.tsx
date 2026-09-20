import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpDown, Building2, Check, ListFilter, Plus, Settings2, Upload } from 'lucide-react';
import { api, patch, post, queryClient, queryString } from '../lib/api';
import { useListState, useMerchants, useOptions, useUsers } from '../lib/hooks';
import { useSession } from '../lib/session';
import { date, iso, localDateTime, today, useDirtyGuard } from '../lib/utils';
import {
  CHANNELS,
  CUSTOMER_STATUSES,
  type Customer,
  type CustomerStatus,
  type Followup,
  type Order,
  type Page,
} from '../lib/types';
import {
  Badge,
  Button,
  ConflictActions,
  DataTable,
  DetailList,
  Empty,
  ErrorMessage,
  Field,
  InfoPopover,
  Input,
  Loading,
  Menu,
  Modal,
  MultiSelect,
  PageHeading,
  Pagination,
  SearchInput,
  Select,
  Sheet,
} from '../components/ui';
import { DictionaryManager } from '../components/dictionary';
import { EntitySelect } from '../components/entity-select';
import { ExportButton, ImportDialog } from '../components/transfers';

const blank = {
  companyName: '',
  taxId: '',
  companyPhone: '',
  companyAddress: '',
  bankName: '',
  bankAccount: '',
  contactName: '',
  contactPhone: '',
  taobaoId: '',
  wechatId: '',
  wechatName: '',
  douyinId: '',
  merchantAccountId: '',
  sourceChannel: '微信',
  status: '待跟进' as CustomerStatus,
  ownerId: '',
  productIds: [] as string[],
  tagIds: [] as string[],
  lastDealAt: '',
  nextFollowupAt: '',
};
type CustomerForm = typeof blank;

export default function Customers() {
  const { user } = useSession();
  const list = useListState({ view: 'all' });
  const [drawer, setDrawer] = useState<{
    id?: string;
    mode: 'view' | 'edit' | 'new';
    tab?: string;
  } | null>(() =>
    list.filters.customer
      ? { id: list.filters.customer, mode: 'view', tab: list.filters.tab }
      : list.filters.action === 'new'
        ? { mode: 'new' }
        : null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [dictionary, setDictionary] = useState('');
  const [moreFilters, setMoreFilters] = useState(
    Boolean(
      list.filters.merchantAccountId ||
      list.filters.productId ||
      list.filters.tagId ||
      list.filters.followup ||
      list.filters.startDate ||
      list.filters.endDate ||
      list.filters.archived,
    ),
  );
  const merchants = useMerchants();
  const tags = useOptions('customer-tag');
  const users = useUsers();
  const query = useQuery({
    queryKey: ['customers', list.params],
    queryFn: ({ signal }) =>
      api<Page<Customer>>(`/customers?${queryString(list.params)}`, { signal }),
  });
  const [action, setAction] = useState<{
    customer: Customer;
    type: 'assign' | 'correction';
  } | null>(null);
  const archive = useMutation({
    mutationFn: (customer: Customer) =>
      post(`/customers/${customer.id}/${customer.archivedAt ? 'restore' : 'archive'}`, {
        version: customer.version,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
  function closeDrawer() {
    setDrawer(null);
    if (list.filters.customer || list.filters.action) {
      list.filter('customer', '');
      list.filter('action', '');
      list.filter('tab', '');
    }
  }
  return (
    <>
      <PageHeading
        title="客户管理"
        count={query.data?.total}
        actions={
          <>
            <ExportButton kind="customers" filters={list.params} />
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              导入
            </Button>
            <Button variant="primary" onClick={() => setDrawer({ mode: 'new' })}>
              <Plus size={16} />
              新增客户
            </Button>
          </>
        }
      />
      <div className="panel">
        <div className="tabs-row">
          <div className="tabs">
            {[
              ['all', '全部客户'],
              ['pending', '待跟进'],
              ['recent_deals', '近期成交'],
            ].map(([key, label]) => (
              <button
                type="button"
                className={list.filters.view === key ? 'active' : ''}
                key={key}
                onClick={() => {
                  list.filter('view', key);
                  if (key === 'recent_deals') {
                    list.filter('startDate', today(-29));
                    list.filter('endDate', today());
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-actions">
            <Button variant="ghost" size="sm" onClick={() => setDictionary('customer-tag')}>
              客户标签
            </Button>
            {user.role === 'BOSS' && (
              <Button variant="ghost" size="sm" onClick={() => setDictionary('merchant-accounts')}>
                <Settings2 size={14} />
                所属账号
              </Button>
            )}
          </div>
        </div>
        <div className="table-toolbar">
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            label="搜索公司、联系人、联系方式"
          />
          <Select
            aria-label="来源渠道"
            value={list.filters.sourceChannel || ''}
            onChange={(event) => list.filter('sourceChannel', event.target.value)}
          >
            <option value="">全部渠道</option>
            {CHANNELS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Select
            aria-label="跟单状态"
            value={list.filters.status || ''}
            onChange={(event) => list.filter('status', event.target.value)}
          >
            <option value="">全部状态</option>
            {CUSTOMER_STATUSES.map((item) => (
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
          <Button
            variant={moreFilters ? 'primary' : 'outline'}
            onClick={() => setMoreFilters(!moreFilters)}
          >
            <ListFilter size={15} />
            筛选
          </Button>
        </div>
        {(moreFilters || list.filters.view === 'recent_deals') && (
          <div className="extended-filters">
            <Select
              aria-label="所属账号"
              value={list.filters.merchantAccountId || ''}
              onChange={(event) => list.filter('merchantAccountId', event.target.value)}
            >
              <option value="">全部所属账号</option>
              {merchants.data?.items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <EntitySelect
              resource="products"
              label="意向产品"
              value={list.filters.productId || ''}
              onChange={(value) => list.filter('productId', value)}
            />
            <Select
              aria-label="客户标签"
              value={list.filters.tagId || ''}
              onChange={(event) => list.filter('tagId', event.target.value)}
            >
              <option value="">全部标签</option>
              {tags.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="跟进计划"
              value={list.filters.followup || ''}
              onChange={(event) => list.filter('followup', event.target.value)}
            >
              <option value="">全部跟进计划</option>
              <option value="today">今日待跟进</option>
              <option value="overdue">逾期待跟进</option>
              <option value="future">未来待跟进</option>
            </Select>
            <div className="date-range">
              <Input
                aria-label="开始日期"
                type="date"
                value={list.filters.startDate || ''}
                onChange={(event) => list.filter('startDate', event.target.value)}
              />
              <span>—</span>
              <Input
                aria-label="结束日期"
                type="date"
                value={list.filters.endDate || ''}
                onChange={(event) => list.filter('endDate', event.target.value)}
              />
            </div>
            <Select
              aria-label="归档状态"
              value={list.filters.archived || ''}
              onChange={(event) => list.filter('archived', event.target.value)}
            >
              <option value="">未归档</option>
              <option value="true">已归档</option>
            </Select>
            <Button variant="ghost" onClick={list.reset}>
              清除筛选
            </Button>
          </div>
        )}
        <ErrorMessage error={archive.error} />
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'companyName',
              header: () => <span>所属公司</span>,
              size: 220,
              cell: ({ row: { original: item } }) => (
                <div className="company-cell">
                  <span className="company-icon">
                    <Building2 size={16} />
                  </span>
                  <div>
                    <InfoPopover
                      label={
                        <span className="cell-strong truncate">
                          {item.companyName || '个人客户'}
                        </span>
                      }
                    >
                      <DetailList
                        values={[
                          ['企业名称', item.companyName],
                          ['税号', item.taxId],
                          ['电话', item.companyPhone],
                          ['地址', item.companyAddress],
                          ['开户行', item.bankName],
                          ['账号', item.bankAccount],
                        ]}
                      />
                    </InfoPopover>
                    <small>{item.customerNo}</small>
                  </div>
                </div>
              ),
            },
            {
              accessorKey: 'contactName',
              header: '联系人',
              size: 150,
              cell: ({ row: { original: item } }) => (
                <div>
                  <InfoPopover label={item.contactName}>
                    <DetailList
                      values={[
                        ['联系电话', item.contactPhone],
                        ['淘宝号', item.taobaoId],
                        ['微信号', item.wechatId],
                        ['微信名称', item.wechatName],
                        ['抖音号', item.douyinId],
                      ]}
                    />
                  </InfoPopover>
                  <small className="cell-secondary">{item.contactPhone || '—'}</small>
                </div>
              ),
            },
            { accessorKey: 'merchantAccountName', header: '所属账号', size: 170 },
            {
              id: 'products',
              header: '意向产品',
              size: 220,
              cell: ({ row }) => (
                <div className="tag-list">
                  {row.original.products?.slice(0, 2).map((item) => (
                    <span className="tag" key={item.id}>
                      {item.name}
                    </span>
                  ))}
                  {(row.original.products?.length || 0) > 2 && (
                    <InfoPopover label={`+${row.original.products.length - 2}`}>
                      <div className="tag-list">
                        {row.original.products.map((item) => (
                          <span className="tag" key={item.id}>
                            {item.name}
                          </span>
                        ))}
                      </div>
                    </InfoPopover>
                  )}
                  {!row.original.products?.length && '—'}
                </div>
              ),
            },
            { accessorKey: 'sourceChannel', header: '来源渠道', size: 115 },
            {
              accessorKey: 'status',
              header: '跟单状态',
              size: 115,
              cell: ({ row }) => <Badge>{row.original.status}</Badge>,
            },
            ...(user.role === 'BOSS'
              ? [{ accessorKey: 'ownerName', header: '负责人', size: 100 }]
              : []),
            {
              accessorKey: 'nextFollowupAt',
              header: () => (
                <button
                  className="table-sort"
                  onClick={() => {
                    list.filter('sort', 'nextFollowupAt');
                    list.filter('order', list.filters.order === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  下次跟进
                  <ArrowUpDown size={12} />
                </button>
              ),
              size: 140,
              cell: ({ row }) => date(row.original.nextFollowupAt, true),
            },
            {
              id: 'actions',
              header: '',
              size: 88,
              cell: ({ row: { original: item } }) => (
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawer({ id: item.id, mode: 'view' })}
                  >
                    查看
                  </Button>
                  <Menu
                    items={[
                      { label: '编辑', onClick: () => setDrawer({ id: item.id, mode: 'edit' }) },
                      {
                        label: '记录跟进',
                        onClick: () => setDrawer({ id: item.id, mode: 'view', tab: 'followups' }),
                      },
                      {
                        label: '创建订单',
                        disabled: !!item.archivedAt,
                        onClick: () => {
                          window.location.href = `/orders/new?customerId=${item.id}`;
                        },
                      },
                      ...(user.role === 'BOSS'
                        ? [
                            {
                              label: '转移负责人',
                              onClick: () => setAction({ customer: item, type: 'assign' }),
                            },
                            {
                              label: '更正成交记录',
                              onClick: () => setAction({ customer: item, type: 'correction' }),
                            },
                            {
                              label: item.archivedAt ? '恢复' : '归档',
                              danger: !item.archivedAt,
                              onClick: () => {
                                if (
                                  confirm(
                                    `确认${item.archivedAt ? '恢复' : '归档'}“${item.companyName || item.contactName}”？`,
                                  )
                                )
                                  archive.mutate(item);
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              ),
            },
          ]}
          emptyAction={
            <Button size="sm" onClick={() => setDrawer({ mode: 'new' })}>
              <Plus size={14} />
              新增客户
            </Button>
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
      {drawer && (
        <CustomerDrawer
          key={`${drawer.id}-${drawer.mode}`}
          {...drawer}
          onClose={closeDrawer}
          onEdit={() => setDrawer({ ...drawer, mode: 'edit' })}
        />
      )}
      {action && <CustomerAction {...action} onClose={() => setAction(null)} />}
      {importOpen && <ImportDialog kind="customers" open onOpenChange={setImportOpen} />}
      <DictionaryManager
        key={dictionary}
        open={!!dictionary}
        onOpenChange={(open) => {
          if (!open) setDictionary('');
        }}
        kind={dictionary}
        title={dictionary === 'merchant-accounts' ? '所属账号' : '客户标签'}
      />
    </>
  );
}

function CustomerDrawer({
  id,
  mode,
  tab: initialTab,
  onClose,
  onEdit,
}: {
  id?: string;
  mode: 'view' | 'edit' | 'new';
  tab?: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { user } = useSession();
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: ({ signal }) => api<Customer>(`/customers/${id}`, { signal }),
    enabled: !!id,
  });
  const [form, setForm] = useState<CustomerForm>({ ...blank });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(initialTab || 'info');
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(50);
  const merchants = useMerchants();
  const tags = useOptions('customer-tag');
  const users = useUsers();
  useEffect(() => {
    if (query.data) {
      const item = query.data;
      setForm({
        ...blank,
        ...item,
        lastDealAt: item.lastDealAt ? localDateTime(item.lastDealAt) : '',
        nextFollowupAt: item.nextFollowupAt ? localDateTime(item.nextFollowupAt) : '',
      });
    }
  }, [query.data]);
  useDirtyGuard(dirty);
  const orders = useQuery({
    queryKey: ['customer-orders', id, orderPage, orderPageSize],
    queryFn: ({ signal }) =>
      api<Page<Order>>(
        `/orders?${queryString({ customerId: id, page: orderPage, pageSize: orderPageSize, archived: 'all' })}`,
        { signal },
      ),
    enabled: !!id && mode === 'view' && tab === 'orders',
  });
  const mutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = Object.fromEntries(
        Object.keys(blank).map((key) => [key, form[key as keyof CustomerForm]]),
      );
      data.lastDealAt = iso(form.lastDealAt);
      data.nextFollowupAt = iso(form.nextFollowupAt);
      if (user.role !== 'BOSS') delete data.ownerId;
      return id
        ? patch(`/customers/${id}`, { ...data, version: query.data?.version })
        : post('/customers', data);
    },
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customer', id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });
  function close() {
    if (!dirty || confirm('有未保存的修改，确认关闭？')) onClose();
  }
  function update<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setDirty(true);
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  const editable = mode !== 'view';
  const item = query.data;
  const textFields = (fields: [keyof CustomerForm, string, boolean?][]) =>
    fields.map(([key, label, required]) => (
      <Field label={label} required={required} key={key}>
        <Input
          value={String(form[key] || '')}
          onChange={(event) => update(key, event.target.value as never)}
          required={required}
          maxLength={key.toLowerCase().includes('address') ? 500 : 200}
        />
      </Field>
    ));
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={
        mode === 'new'
          ? '新增客户'
          : mode === 'edit'
            ? '编辑客户'
            : item?.companyName || item?.contactName || '客户详情'
      }
      footer={
        editable ? (
          <>
            <span className="save-status">{dirty ? '未保存' : ''}</span>
            <Button onClick={close}>取消</Button>
            <Button
              variant="primary"
              type="submit"
              form="customer-form"
              pending={mutation.isPending}
            >
              保存
            </Button>
          </>
        ) : (
          item && (
            <>
              {!item.archivedAt && (
                <Link className="button button-outline" to={`/orders/new?customerId=${id}`}>
                  创建订单
                </Link>
              )}
              <Button variant="primary" onClick={onEdit}>
                编辑客户
              </Button>
            </>
          )
        )
      }
    >
      {id && query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorMessage error={query.error} retry={() => void query.refetch()} />
      ) : editable ? (
        <form
          id="customer-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <ErrorMessage error={mutation.error} />
          <ConflictActions
            error={mutation.error}
            onReload={() => {
              setDirty(false);
              mutation.reset();
              void query.refetch();
            }}
            onKeep={() => mutation.reset()}
          />
          <div className="form-section">
            <h3>联系人</h3>
            <div className="form-grid">
              {textFields([
                ['contactName', '姓名 / 称呼', true],
                ['contactPhone', '联系电话'],
                ['taobaoId', '淘宝号'],
                ['wechatId', '微信号'],
                ['wechatName', '微信名称'],
                ['douyinId', '抖音号'],
              ])}
            </div>
          </div>
          <div className="form-section">
            <h3>所属公司</h3>
            <div className="form-grid">
              {textFields([
                ['companyName', '企业名称'],
                ['taxId', '税号'],
                ['companyPhone', '公司电话'],
                ['companyAddress', '公司地址'],
                ['bankName', '开户行'],
                ['bankAccount', '银行账号'],
              ])}
            </div>
          </div>
          <div className="form-section">
            <h3>业务信息</h3>
            <div className="form-grid">
              <Field label="所属账号" required>
                <Select
                  required
                  value={form.merchantAccountId}
                  onChange={(event) => update('merchantAccountId', event.target.value)}
                >
                  <option value="">选择所属账号</option>
                  {merchants.data?.items
                    .filter(
                      (account) =>
                        account.enabled !== false || account.id === form.merchantAccountId,
                    )
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="来源渠道" required>
                <Select
                  value={form.sourceChannel}
                  onChange={(event) => update('sourceChannel', event.target.value)}
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel}>{channel}</option>
                  ))}
                </Select>
              </Field>
              <Field label="跟单状态" required>
                <Select
                  value={form.status}
                  onChange={(event) => update('status', event.target.value as CustomerStatus)}
                  disabled={item?.status === '已付款'}
                >
                  {CUSTOMER_STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </Select>
              </Field>
              {user.role === 'BOSS' && mode === 'new' && (
                <Field label="负责人" required>
                  <Select
                    required
                    value={form.ownerId}
                    onChange={(event) => update('ownerId', event.target.value)}
                  >
                    <option value="">选择负责人</option>
                    {users.data?.items
                      .filter((person) => person.accountStatus === 'ACTIVE')
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              <Field label="下次跟进">
                <Input
                  type="datetime-local"
                  value={form.nextFollowupAt}
                  onChange={(event) => update('nextFollowupAt', event.target.value)}
                />
              </Field>
              {form.status === '已付款' && (
                <Field label="最近成交时间" required>
                  <Input
                    type="datetime-local"
                    required
                    max={localDateTime()}
                    min={item?.lastDealAt ? localDateTime(item.lastDealAt) : undefined}
                    value={form.lastDealAt}
                    onChange={(event) => update('lastDealAt', event.target.value)}
                  />
                </Field>
              )}
              <Field label="意向产品" className="span-two">
                <EntitySelect
                  resource="products"
                  label="意向产品"
                  multiple
                  value={form.productIds}
                  onChange={(value) => update('productIds', value)}
                />
              </Field>
              <Field label="客户标签" className="span-two">
                <MultiSelect
                  label="客户标签"
                  options={tags.data?.items || []}
                  value={form.tagIds}
                  onChange={(value) => update('tagIds', value)}
                />
              </Field>
            </div>
          </div>
        </form>
      ) : (
        item && (
          <>
            <div className="detail-identity">
              <span className="company-icon large">
                <Building2 size={24} />
              </span>
              <div>
                <strong>{item.contactName}</strong>
                <small>{item.customerNo}</small>
              </div>
              <Badge>{item.status}</Badge>
            </div>
            <div className="tabs detail-tabs">
              {[
                ['info', '客户资料'],
                ['followups', '跟进记录'],
                ['orders', '关联订单'],
              ].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => setTab(key)}
                  className={tab === key ? 'active' : ''}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'info' && (
              <>
                <h3 className="detail-section-title">联系人</h3>
                <DetailList
                  values={[
                    ['姓名 / 称呼', item.contactName],
                    ['联系电话', item.contactPhone],
                    ['淘宝号', item.taobaoId],
                    ['微信号', item.wechatId],
                    ['微信名称', item.wechatName],
                    ['抖音号', item.douyinId],
                  ]}
                />
                <h3 className="detail-section-title">所属公司</h3>
                <DetailList
                  values={[
                    ['企业名称', item.companyName],
                    ['税号', item.taxId],
                    ['电话', item.companyPhone],
                    ['地址', item.companyAddress],
                    ['开户行', item.bankName],
                    ['银行账号', item.bankAccount],
                  ]}
                />
                <h3 className="detail-section-title">业务信息</h3>
                <DetailList
                  values={[
                    ['所属账号', item.merchantAccountName],
                    ['来源渠道', item.sourceChannel],
                    [
                      '意向产品',
                      <div className="tag-list">
                        {item.products?.map((product) => (
                          <span className="tag" key={product.id}>
                            {product.name}
                          </span>
                        ))}
                      </div>,
                    ],
                    [
                      '标签',
                      <div className="tag-list">
                        {item.tags?.map((tag) => (
                          <span className="tag" key={tag.id}>
                            {tag.name}
                          </span>
                        ))}
                      </div>,
                    ],
                    ['负责人', item.ownerName],
                    ['最近成交', date(item.lastDealAt, true)],
                    ['下次跟进', date(item.nextFollowupAt, true)],
                  ]}
                />
                <Link to={`/materials?customerId=${item.id}`} className="button button-outline">
                  匹配资料
                </Link>
              </>
            )}
            {tab === 'followups' && <Followups customer={item} onDirtyChange={setDirty} />}
            {tab === 'orders' && (
              <>
                <DataTable
                  data={orders.data?.items || []}
                  loading={orders.isPending}
                  error={orders.error}
                  columns={[
                    {
                      accessorKey: 'orderNo',
                      header: '订单编号',
                      cell: ({ row }) => (
                        <Link className="text-link" to={`/orders/${row.original.id}`}>
                          {row.original.orderNo}
                        </Link>
                      ),
                    },
                    { accessorKey: 'orderDate', header: '下单日期' },
                    {
                      accessorKey: 'status',
                      header: '状态',
                      cell: ({ row }) => <Badge>{row.original.status}</Badge>,
                    },
                    { accessorKey: 'totalInclTax', header: '含税总计' },
                  ]}
                />
                <Pagination
                  total={orders.data?.total || 0}
                  page={orderPage}
                  pageSize={orderPageSize}
                  onPage={setOrderPage}
                  onPageSize={(value) => {
                    setOrderPageSize(value);
                    setOrderPage(1);
                  }}
                />
              </>
            )}
          </>
        )
      )}
    </Sheet>
  );
}

function Followups({
  customer,
  onDirtyChange,
}: {
  customer: Customer;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const query = useQuery({
    queryKey: ['followups', customer.id, page, pageSize],
    queryFn: () =>
      api<Page<Followup>>(`/customers/${customer.id}/followups?${queryString({ page, pageSize })}`),
  });
  const [editing, setEditing] = useState<Followup | null>(null);
  const [content, setContent] = useState('');
  const [occurredAt, setOccurredAt] = useState(localDateTime());
  const [channel, setChannel] = useState('微信');
  const [next, setNext] = useState('');
  useEffect(() => {
    onDirtyChange(Boolean(content || next));
  }, [content, next, onDirtyChange]);
  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        content,
        occurredAt: iso(occurredAt),
        contactChannel: channel,
        nextFollowupAt: iso(next),
        version: editing?.version || customer.version,
      };
      return editing
        ? patch(`/customers/${customer.id}/followups/${editing.id}`, body)
        : post(`/customers/${customer.id}/followups`, body);
    },
    onSuccess: () => {
      setContent('');
      setNext('');
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['followups', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const complete = useMutation({
    mutationFn: () =>
      post(`/customers/${customer.id}/followup-task/complete`, {
        version: customer.version,
        nextFollowupAt: null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  return (
    <>
      <form
        className="followup-form form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label={editing ? '修改跟进内容' : '跟进内容'} required>
          <textarea
            className="input"
            rows={3}
            required
            maxLength={5000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="跟进时间" required>
            <Input
              type="datetime-local"
              value={occurredAt}
              max={localDateTime()}
              onChange={(event) => setOccurredAt(event.target.value)}
              required
            />
          </Field>
          <Field label="联系渠道">
            <Select value={channel} onChange={(event) => setChannel(event.target.value)}>
              {CHANNELS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Field>
          <Field label="下次跟进">
            <Input
              type="datetime-local"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
        </div>
        <ErrorMessage error={mutation.error || complete.error} />
        <div className="inline-actions">
          {customer.nextFollowupAt && (
            <Button pending={complete.isPending} onClick={() => complete.mutate()}>
              <Check size={14} />
              完成当前待办
            </Button>
          )}
          {editing && (
            <Button
              onClick={() => {
                setEditing(null);
                setContent('');
                setNext('');
              }}
            >
              取消修改
            </Button>
          )}
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {editing ? '保存修改' : '记录跟进'}
          </Button>
        </div>
      </form>
      <div className="timeline">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorMessage error={query.error} />
        ) : query.data?.items.length ? (
          query.data.items.map((item) => (
            <article key={item.id}>
              <span className="timeline-dot" />
              <div className="timeline-header">
                <strong>{item.actorName}</strong>
                <span>{item.contactChannel}</span>
                <small>{date(item.occurredAt, true)}</small>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(item);
                    setContent(item.content);
                    setOccurredAt(localDateTime(item.occurredAt));
                    setChannel(item.contactChannel);
                    setNext(item.nextFollowupAt ? localDateTime(item.nextFollowupAt) : '');
                  }}
                >
                  编辑
                </Button>
              </div>
              <p>{item.content}</p>
              {item.nextFollowupAt && <small>下次跟进 {date(item.nextFollowupAt, true)}</small>}
            </article>
          ))
        ) : (
          <Empty label="暂无跟进记录" />
        )}
      </div>
      <Pagination
        total={query.data?.total || 0}
        page={page}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
    </>
  );
}

function CustomerAction({
  customer,
  type,
  onClose,
}: {
  customer: Customer;
  type: 'assign' | 'correction';
  onClose: () => void;
}) {
  const users = useUsers();
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState(customer.status);
  const [lastDealAt, setLastDealAt] = useState(
    customer.lastDealAt ? localDateTime(customer.lastDealAt) : '',
  );
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      post(
        `/customers/${customer.id}/${type === 'assign' ? 'assign' : 'deal-correction'}`,
        type === 'assign'
          ? { version: customer.version, ownerId }
          : { version: customer.version, status, lastDealAt: iso(lastDealAt), reason },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
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
      title={type === 'assign' ? '转移负责人' : '更正成交记录'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="submit"
            form="customer-action"
            variant="primary"
            pending={mutation.isPending}
          >
            确认
          </Button>
        </>
      }
    >
      <form
        id="customer-action"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <DetailList
          values={[
            ['客户', customer.companyName || customer.contactName],
            ['当前负责人', customer.ownerName],
          ]}
        />
        {type === 'assign' ? (
          <Field label="新负责人" required>
            <Select required value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="">选择负责人</option>
              {users.data?.items
                .filter((item) => item.accountStatus === 'ACTIVE' && item.id !== customer.ownerId)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.displayName}
                  </option>
                ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="跟单状态" required>
              <Select
                value={status}
                onChange={(event) => setStatus(event.target.value as CustomerStatus)}
              >
                {CUSTOMER_STATUSES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field label="最近成交时间" required={status === '已付款'}>
              <Input
                type="datetime-local"
                required={status === '已付款'}
                value={lastDealAt}
                max={localDateTime()}
                onChange={(event) => setLastDealAt(event.target.value)}
              />
            </Field>
            <Field label="更正原因" required>
              <textarea
                className="input"
                rows={3}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </>
        )}
        <ErrorMessage error={mutation.error} />
      </form>
    </Modal>
  );
}
