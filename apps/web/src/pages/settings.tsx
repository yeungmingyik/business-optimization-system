import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { Check, Copy, KeyRound, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { api, patch, post, queryClient, queryString } from '../lib/api';
import { useListState, useUsers } from '../lib/hooks';
import { useSession } from '../lib/session';
import { date } from '../lib/utils';
import { fieldLabels } from '../lib/labels';
import type { Page, User } from '../lib/types';
import {
  Badge,
  Button,
  DataTable,
  DetailList,
  ErrorMessage,
  Field,
  Input,
  Menu,
  Modal,
  PageHeading,
  Pagination,
  SearchInput,
  Select,
  Sheet,
} from '../components/ui';

export default function Settings() {
  const path = useLocation().pathname;
  const { user } = useSession();
  if (user.role !== 'BOSS') return <ErrorMessage error="无权访问" />;
  return path.endsWith('/audit') ? <Audit /> : <Accounts />;
}

function Accounts() {
  const list = useListState();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [password, setPassword] = useState<{ loginName: string; temporaryPassword: string } | null>(
    null,
  );
  const query = useQuery({
    queryKey: ['users', list.params],
    queryFn: ({ signal }) => api<Page<User>>(`/users?${queryString(list.params)}`, { signal }),
  });
  const mutation = useMutation({
    mutationFn: ({ user, reset }: { user: User; reset: boolean }) =>
      reset
        ? post<{ temporaryPassword: string }>(`/users/${user.id}/reset-password`, {
            version: user.version,
          })
        : patch(`/users/${user.id}`, {
            version: user.version,
            displayName: user.displayName,
            role: user.role,
            accountStatus: user.accountStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
          }),
    onSuccess: (result, variables) => {
      if (variables.reset)
        setPassword({
          loginName: variables.user.loginName,
          temporaryPassword: String(result.temporaryPassword),
        });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-options'] });
    },
  });
  return (
    <>
      <PageHeading
        title="账号管理"
        count={query.data?.total}
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} />
            创建账号
          </Button>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput label="搜索姓名、账号" value={list.search} onChange={list.setSearch} />
          <Select
            aria-label="账号角色"
            value={list.filters.role || ''}
            onChange={(event) => list.filter('role', event.target.value)}
          >
            <option value="">全部角色</option>
            <option value="OPERATOR">运营人员</option>
            <option value="BOSS">企业老板</option>
          </Select>
          <Select
            aria-label="账号状态"
            value={list.filters.accountStatus || ''}
            onChange={(event) => list.filter('accountStatus', event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">停用</option>
          </Select>
        </div>
        <ErrorMessage error={mutation.error} />
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'displayName',
              header: '姓名',
              cell: ({ row }) => (
                <div className="company-cell">
                  <span className="avatar">{row.original.displayName.slice(0, 1)}</span>
                  <strong>{row.original.displayName}</strong>
                </div>
              ),
            },
            { accessorKey: 'loginName', header: '账号' },
            {
              accessorKey: 'role',
              header: '角色',
              cell: ({ row }) => (
                <span className="role-label">
                  {row.original.role === 'BOSS' ? (
                    <ShieldCheck size={15} />
                  ) : (
                    <UserRound size={15} />
                  )}
                  {row.original.role === 'BOSS' ? '企业老板' : '运营人员'}
                </span>
              ),
            },
            {
              accessorKey: 'accountStatus',
              header: '状态',
              cell: ({ row }) => (
                <Badge tone={row.original.accountStatus === 'ACTIVE' ? 'green' : 'neutral'}>
                  {row.original.accountStatus === 'ACTIVE' ? '启用' : '停用'}
                </Badge>
              ),
            },
            {
              accessorKey: 'lastLoginAt',
              header: '最近登录',
              cell: ({ row }) => date(row.original.lastLoginAt, true),
            },
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <div className="row-actions">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row.original)}>
                    编辑
                  </Button>
                  <Menu
                    items={[
                      {
                        label: '重置密码',
                        onClick: () => {
                          if (confirm(`确认重置“${row.original.displayName}”的密码？`))
                            mutation.mutate({ user: row.original, reset: true });
                        },
                      },
                      {
                        label: row.original.accountStatus === 'ACTIVE' ? '停用账号' : '启用账号',
                        danger: row.original.accountStatus === 'ACTIVE',
                        onClick: () => {
                          if (
                            confirm(
                              `确认${row.original.accountStatus === 'ACTIVE' ? '停用' : '启用'}“${row.original.displayName}”？`,
                            )
                          )
                            mutation.mutate({ user: row.original, reset: false });
                        },
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
        <Pagination
          total={query.data?.total || 0}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>
      {editing && (
        <AccountEditor
          user={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onPassword={(value) => {
            setPassword(value);
            setEditing(null);
          }}
        />
      )}
      {password && <TemporaryPassword value={password} onClose={() => setPassword(null)} />}
    </>
  );
}

function AccountEditor({
  user,
  onClose,
  onPassword,
}: {
  user?: User;
  onClose: () => void;
  onPassword: (value: { loginName: string; temporaryPassword: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [loginName, setLoginName] = useState(user?.loginName || '');
  const [role, setRole] = useState(user?.role || 'OPERATOR');
  const mutation = useMutation({
    mutationFn: () =>
      user
        ? patch(`/users/${user.id}`, {
            version: user.version,
            displayName,
            role,
            accountStatus: user.accountStatus,
          })
        : post<{ user: User; temporaryPassword: string }>('/users', {
            loginName,
            displayName,
            role,
          }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-options'] });
      if (!user) onPassword({ loginName, temporaryPassword: String(result.temporaryPassword) });
      else onClose();
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={user ? '编辑账号' : '创建账号'}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" type="submit" form="account-form" pending={mutation.isPending}>
            {user ? '保存' : '创建账号'}
          </Button>
        </>
      }
    >
      <form
        id="account-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="姓名" required>
          <Input
            autoFocus
            required
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label="账号" required>
          <Input
            required
            disabled={!!user}
            minLength={3}
            maxLength={100}
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="角色" required>
          <Select value={role} onChange={(event) => setRole(event.target.value as User['role'])}>
            <option value="OPERATOR">运营人员</option>
            <option value="BOSS">企业老板</option>
          </Select>
        </Field>
        <ErrorMessage error={mutation.error} />
      </form>
    </Modal>
  );
}

function TemporaryPassword({
  value,
  onClose,
}: {
  value: { loginName: string; temporaryPassword: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && confirm('关闭后无法再次查看临时密码，确认关闭？')) onClose();
      }}
      title="临时密码"
      footer={
        <Button
          variant="primary"
          onClick={() => {
            if (confirm('关闭后无法再次查看临时密码，确认关闭？')) onClose();
          }}
        >
          完成
        </Button>
      }
    >
      <div className="temporary-password">
        <span className="overview-icon icon-amber">
          <KeyRound size={24} />
        </span>
        <DetailList
          values={[
            ['账号', value.loginName],
            ['临时密码', <code>{value.temporaryPassword}</code>],
          ]}
        />
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(value.temporaryPassword)
              .then(() => setCopied(true))
              .catch(() => setError('复制失败，请手动复制'));
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? '已复制' : '复制密码'}
        </Button>
        <ErrorMessage error={error} />
      </div>
    </Modal>
  );
}

interface AuditRecord {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string;
  operation: string;
  changes: Record<string, unknown>;
  createdAt: string;
}
const entityLabels: Record<string, string> = {
  customer: '客户',
  customers: '客户',
  order: '订单',
  orders: '订单',
  product: '产品',
  products: '产品',
  asset: '资料',
  assets: '资料',
  user: '账号',
  users: '账号',
  import: '导入',
  dictionary: '字典',
  merchantAccount: '所属账号',
  followup: '跟进记录',
};
const operationLabels: Record<string, string> = {
  create: '创建',
  update: '修改',
  archive: '归档',
  restore: '恢复',
  assign: '转移负责人',
  payment: '登记付款',
  cancel: '取消付款',
  'payment-correction': '更正付款',
  'deal-correction': '更正成交记录',
  'reset-password': '重置密码',
  commit: '提交导入',
  replace: '替换文件',
};
function businessValue(value: unknown): string {
  if (value === 'auto') return '自动计算';
  if (value === 'manual') return '手动金额';
  if (value === null || value === undefined) return '—';
  if (value === true) return '是';
  if (value === false) return '否';
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([key, item]) => `${fieldLabels[key] || key}：${businessValue(item)}`)
      .join('；');
  return (
    (
      {
        BOSS: '企业老板',
        OPERATOR: '运营人员',
        ACTIVE: '启用',
        DISABLED: '停用',
        customers: '客户',
        products: '产品',
        orders: '订单',
        'customer-tag': '客户标签',
        'product-category': '产品分类',
        'product-tag': '产品标签',
        'asset-category': '资料分类',
        'asset-tag': '资料标签',
      } as Record<string, string>
    )[String(value)] || String(value)
  );
}
function Audit() {
  const list = useListState();
  const users = useUsers();
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const query = useQuery({
    queryKey: ['audit', list.params],
    queryFn: ({ signal }) =>
      api<Page<AuditRecord>>(`/audit-events?${queryString(list.params)}`, { signal }),
  });
  return (
    <>
      <PageHeading title="操作记录" count={query.data?.total} />
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput label="搜索操作者、动作" value={list.search} onChange={list.setSearch} />
          <Select
            aria-label="操作者"
            value={list.filters.actorId || ''}
            onChange={(event) => list.filter('actorId', event.target.value)}
          >
            <option value="">全部操作者</option>
            {users.data?.items.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </Select>
          <Select
            aria-label="操作对象"
            value={list.filters.entityType || ''}
            onChange={(event) => list.filter('entityType', event.target.value)}
          >
            <option value="">全部对象</option>
            {['customer', 'order', 'product', 'asset', 'user', 'import'].map((key) => (
              <option value={key} key={key}>
                {entityLabels[key]}
              </option>
            ))}
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
        </div>
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'createdAt',
              header: '操作时间',
              cell: ({ row }) => date(row.original.createdAt, true),
            },
            { accessorKey: 'actorName', header: '操作者' },
            {
              accessorKey: 'entityType',
              header: '对象',
              cell: ({ row }) => entityLabels[row.original.entityType] || row.original.entityType,
            },
            {
              accessorKey: 'operation',
              header: '动作',
              cell: ({ row }) => operationLabels[row.original.operation] || row.original.operation,
            },
            {
              accessorKey: 'entityId',
              header: '记录编号',
              cell: ({ row }) => <span className="record-id">{row.original.entityId}</span>,
            },
            {
              id: 'action',
              header: '',
              cell: ({ row }) => (
                <Button variant="ghost" size="sm" onClick={() => setRecord(row.original)}>
                  变更详情
                </Button>
              ),
            },
          ]}
        />
        <Pagination
          total={query.data?.total || 0}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>
      {record && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setRecord(null);
          }}
          title="变更详情"
        >
          <DetailList
            values={[
              ['操作者', record.actorName],
              ['操作时间', date(record.createdAt, true)],
              ['对象', entityLabels[record.entityType] || record.entityType],
              ['动作', operationLabels[record.operation] || record.operation],
              ['记录编号', record.entityId],
            ]}
          />
          <h3 className="detail-section-title">业务变更</h3>
          <DetailList
            values={Object.entries(record.changes || {}).map(([key, value]) => [
              fieldLabels[key] || key,
              businessValue(value),
            ])}
          />
        </Sheet>
      )}
    </>
  );
}
