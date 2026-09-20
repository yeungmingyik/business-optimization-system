import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  Plus,
  Users,
} from 'lucide-react';
import { api, queryString } from '../lib/api';
import { date, money, today } from '../lib/utils';
import { useSession } from '../lib/session';
import { useUsers } from '../lib/hooks';
import type { Customer, Page, Summary } from '../lib/types';
import {
  Badge,
  Button,
  DataTable,
  Empty,
  ErrorMessage,
  Input,
  Loading,
  PageHeading,
  Section,
  Select,
} from '../components/ui';

export default function Dashboard() {
  const { user } = useSession();
  const [startDate, setStartDate] = useState(today(-29));
  const [endDate, setEndDate] = useState(today());
  const [ownerId, setOwnerId] = useState('');
  const [showTable, setShowTable] = useState(false);
  const users = useUsers();
  const filters = { startDate, endDate, ownerId };
  const summary = useQuery({
    queryKey: ['dashboard', 'summary', filters],
    queryFn: ({ signal }) => api<Summary>(`/dashboard/summary?${queryString(filters)}`, { signal }),
  });
  const followups = useQuery({
    queryKey: ['dashboard', 'followups', ownerId],
    queryFn: ({ signal }) =>
      api<Page<Customer>>(`/dashboard/followups?${queryString({ ownerId, pageSize: 20 })}`, {
        signal,
      }),
  });
  const trends = useQuery({
    queryKey: ['dashboard', 'trends', filters],
    queryFn: ({ signal }) =>
      api<{ date: string; amount: string; count: number }[]>(
        `/dashboard/trends?${queryString(filters)}`,
        { signal },
      ),
  });
  const range = queryString(filters);
  const metrics = summary.data && [
    {
      title: user.role === 'BOSS' ? '客户总数' : '我的客户',
      value: summary.data.customerCount.toLocaleString(),
      unit: '位',
      icon: Users,
      color: 'red',
      url: `/customers?${queryString({ ownerId })}`,
      sub: `待跟进 ${summary.data.pendingCustomerCount} 位`,
    },
    {
      title: '今日待跟进',
      value: summary.data.todayFollowupCount.toLocaleString(),
      unit: '位',
      icon: CalendarClock,
      color: 'amber',
      url: `/customers?followup=today&${queryString({ ownerId })}`,
      sub: `逾期 ${summary.data.overdueFollowupCount} 位`,
    },
    {
      title: '待付款金额',
      value: money(summary.data.pendingAmount),
      unit: '元',
      icon: Banknote,
      color: 'blue',
      url: `/orders?status=待付款&type=正常&${range}`,
      sub: '待付款 · 正常订单',
    },
    {
      title: '正常订单成交额',
      value: money(summary.data.dealAmount),
      unit: '元',
      icon: CheckCheck,
      color: 'green',
      url: `/orders?status=已付款&type=正常&dateField=paidAt&archived=all&${range}`,
      sub: `已付款 ${summary.data.dealOrderCount} 笔`,
    },
  ];
  const values = trends.data?.map((item) => Number(item.amount)) || [];
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${32 + (index * 716) / Math.max(values.length - 1, 1)},${170 - (value / max) * 130}`,
    )
    .join(' ');
  return (
    <>
      <PageHeading
        title="工作台"
        actions={
          <>
            <Link to="/customers" search={{ action: 'new' }} className="button button-outline">
              <Plus size={16} />
              新增客户
            </Link>
            <Link to="/orders/new" className="button button-primary">
              <Plus size={16} />
              新增订单
            </Link>
          </>
        }
      >
        <div className="page-subline">
          {new Intl.DateTimeFormat('zh-CN', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(new Date())}
        </div>
      </PageHeading>
      <div className="dashboard-filters">
        {user.role === 'BOSS' && (
          <Select
            aria-label="负责人"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">全部负责人</option>
            {users.data?.items.map((item) => (
              <option value={item.id} key={item.id}>
                {item.displayName}
              </option>
            ))}
          </Select>
        )}
        <div className="date-range">
          <Input
            aria-label="开始日期"
            type="date"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <span>—</span>
          <Input
            aria-label="结束日期"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </div>
      <ErrorMessage error={summary.error} retry={() => void summary.refetch()} />
      {summary.isPending ? (
        <Loading rows={2} />
      ) : (
        <div className="metrics-grid">
          {metrics &&
            metrics.map((metric) => (
              <Link key={metric.title} to={metric.url} className="metric-card">
                <div className="metric-top">
                  <span>{metric.title}</span>
                  <span className={`metric-icon icon-${metric.color}`}>
                    <metric.icon size={18} strokeWidth={1.7} />
                  </span>
                </div>
                <div className="metric-value">
                  {metric.value}
                  <span>{metric.unit}</span>
                </div>
                <div className="metric-bottom">
                  <span>{metric.sub}</span>
                  <ArrowUpRight size={15} />
                </div>
              </Link>
            ))}
        </div>
      )}
      <div className="dashboard-middle">
        <Section
          title="已付款金额"
          action={
            <Button size="sm" variant="ghost" onClick={() => setShowTable(!showTable)}>
              {showTable ? '趋势图' : '数据表'}
            </Button>
          }
        >
          <div className="trend-heading">
            <span>正常订单</span>
            <strong>¥ {summary.data ? money(summary.data.dealAmount) : '—'}</strong>
          </div>
          <ErrorMessage error={trends.error} retry={() => void trends.refetch()} />
          {trends.isPending ? (
            <Loading rows={3} />
          ) : !values.length ? (
            <Empty />
          ) : showTable ? (
            <DataTable
              data={trends.data || []}
              columns={[
                { accessorKey: 'date', header: '日期' },
                { accessorKey: 'count', header: '订单数' },
                {
                  accessorKey: 'amount',
                  header: '已付款金额（元）',
                  cell: (info) => money(String(info.getValue())),
                },
              ]}
            />
          ) : (
            <div className="trend-chart">
              <svg viewBox="0 0 780 210" role="img" aria-label="正常订单已付款金额趋势">
                <defs>
                  <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#c81e2b" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#c81e2b" stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                {[40, 105, 170].map((y) => (
                  <line
                    key={y}
                    x1="32"
                    y1={y}
                    x2="748"
                    y2={y}
                    stroke="#e8edf2"
                    strokeDasharray="3 5"
                  />
                ))}
                {values.some((value) => value > 0) && (
                  <>
                    <polygon points={`32,170 ${points} 748,170`} fill="url(#trend-fill)" />
                    <polyline
                      points={points}
                      fill="none"
                      stroke="#c81e2b"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
                <text x="32" y="200">
                  {startDate.slice(5)}
                </text>
                <text x="748" y="200" textAnchor="end">
                  {endDate.slice(5)}
                </text>
                <text x="32" y="22">
                  ¥ {money(max === 1 && !values.some(Boolean) ? 0 : max)}
                </text>
              </svg>
            </div>
          )}
        </Section>
        <Section title="业务概览" className="business-overview">
          {summary.data && (
            <>
              <Link to={`/customers?view=recent_deals&${range}`}>
                <span className="overview-icon icon-green">
                  <Users size={18} />
                </span>
                <span>
                  近期成交客户
                  <strong>
                    {summary.data.recentDealCustomerCount}
                    <small> 位</small>
                  </strong>
                </span>
                <ChevronRight size={16} />
              </Link>
              <Link to={`/orders?type=退货&status=已付款&dateField=paidAt&archived=all&${range}`}>
                <span className="overview-icon icon-amber">
                  <ArrowDownRight size={18} />
                </span>
                <span>
                  退货记录
                  <strong>
                    {summary.data.returnCount}
                    <small> 笔 · ¥ {money(summary.data.returnAmount)}</small>
                  </strong>
                </span>
                <ChevronRight size={16} />
              </Link>
              <Link to={`/orders?type=维修&status=已付款&dateField=paidAt&archived=all&${range}`}>
                <span className="overview-icon icon-blue">
                  <CheckCheck size={18} />
                </span>
                <span>
                  维修记录
                  <strong>
                    {summary.data.repairCount}
                    <small> 笔 · ¥ {money(summary.data.repairAmount)}</small>
                  </strong>
                </span>
                <ChevronRight size={16} />
              </Link>
            </>
          )}
        </Section>
      </div>
      <Section
        title="跟进待办"
        action={
          <Link to="/customers" search={{ followup: 'today', ownerId }} className="text-link">
            全部待办
            <ChevronRight size={15} />
          </Link>
        }
      >
        <DataTable
          data={followups.data?.items || []}
          loading={followups.isPending}
          error={followups.error}
          onRetry={() => void followups.refetch()}
          columns={[
            {
              accessorKey: 'companyName',
              header: '所属公司',
              cell: ({ row }) => (
                <span className="cell-strong">{row.original.companyName || '个人客户'}</span>
              ),
            },
            { accessorKey: 'contactName', header: '联系人' },
            {
              accessorKey: 'status',
              header: '跟单状态',
              cell: ({ row }) => <Badge>{row.original.status}</Badge>,
            },
            {
              accessorKey: 'nextFollowupAt',
              header: '下次跟进',
              cell: ({ row }) => (
                <span
                  className={
                    row.original.nextFollowupAt &&
                    row.original.nextFollowupAt.slice(0, 10) < today()
                      ? 'text-danger'
                      : ''
                  }
                >
                  {date(row.original.nextFollowupAt, true)}
                </span>
              ),
            },
            ...(user.role === 'BOSS' ? [{ accessorKey: 'ownerName', header: '负责人' }] : []),
            {
              id: 'action',
              header: '',
              cell: ({ row }) => (
                <Link
                  to="/customers"
                  search={{ customer: row.original.id, tab: 'followups' }}
                  className="text-link"
                >
                  记录跟进
                  <ChevronRight size={14} />
                </Link>
              ),
            },
          ]}
        />
      </Section>
    </>
  );
}
