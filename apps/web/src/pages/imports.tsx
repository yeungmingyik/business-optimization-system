import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { api, queryString } from '../lib/api';
import { useListState } from '../lib/hooks';
import { date } from '../lib/utils';
import { useSession } from '../lib/session';
import type { Page } from '../lib/types';
import { Badge, Button, DataTable, PageHeading, Pagination, Select } from '../components/ui';
import { ImportDialog, kindLabels, jobStatus, type ImportJob } from '../components/transfers';

export default function Imports() {
  const { user } = useSession();
  const list = useListState();
  const [dialog, setDialog] = useState<{ kind: string; id?: string } | null>(null);
  const [newKind, setNewKind] = useState('customers');
  const query = useQuery({
    queryKey: ['imports', list.params],
    queryFn: ({ signal }) =>
      api<Page<ImportJob & { filename?: string }>>(`/imports?${queryString(list.params)}`, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => ['QUEUED', 'RUNNING'].includes(item.status))
        ? 2000
        : false,
  });
  return (
    <>
      <PageHeading
        title="导入记录"
        count={query.data?.total}
        actions={
          <>
            <Select
              aria-label="导入对象"
              value={newKind}
              onChange={(event) => setNewKind(event.target.value)}
            >
              {Object.entries(kindLabels).map(([key, value]) => (
                <option value={key} key={key}>
                  {value}
                </option>
              ))}
            </Select>
            <Button variant="primary" onClick={() => setDialog({ kind: newKind })}>
              <Plus size={16} />
              发起导入
            </Button>
          </>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <Select
            aria-label="导入类型"
            value={list.filters.kind || ''}
            onChange={(event) => list.filter('kind', event.target.value)}
          >
            <option value="">全部对象</option>
            {Object.entries(kindLabels).map(([key, value]) => (
              <option value={key} key={key}>
                {value}
              </option>
            ))}
          </Select>
          <Select
            aria-label="导入状态"
            value={list.filters.status || ''}
            onChange={(event) => list.filter('status', event.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(jobStatus).map(([key, value]) => (
              <option value={key} key={key}>
                {value}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'createdAt',
              header: '创建时间',
              cell: ({ row }) => date(row.original.createdAt, true),
            },
            ...(user.role === 'BOSS' ? [{ accessorKey: 'actorName', header: '发起人' }] : []),
            {
              id: 'file',
              header: '文件',
              cell: ({ row }) => (
                <div className="company-cell">
                  <span className="file-icon">
                    <FileSpreadsheet size={21} />
                  </span>
                  <span>{row.original.filename || `${kindLabels[row.original.kind]}导入`}</span>
                </div>
              ),
            },
            {
              accessorKey: 'kind',
              header: '对象',
              cell: ({ row }) => kindLabels[row.original.kind],
            },
            {
              id: 'phase',
              header: '阶段',
              cell: ({ row }) => (row.original.phase === 'COMMIT' ? '导入' : '预检'),
            },
            {
              accessorKey: 'status',
              header: '状态',
              cell: ({ row }) => (
                <Badge
                  tone={
                    row.original.status === 'FAILED'
                      ? 'red'
                      : row.original.status === 'SUCCEEDED'
                        ? 'green'
                        : 'amber'
                  }
                >
                  {row.original.phase === 'PREVIEW' && row.original.status === 'SUCCEEDED'
                    ? row.original.previewValid
                      ? '待确认'
                      : '校验未通过'
                    : jobStatus[row.original.status]}
                </Badge>
              ),
            },
            { accessorKey: 'rowCount', header: '数据行数' },
            {
              id: 'result',
              header: '结果',
              cell: ({ row }) =>
                row.original.phase === 'COMMIT' && row.original.status === 'SUCCEEDED'
                  ? `新增 ${row.original.createdCount ?? row.original.expectedNew} 条`
                  : row.original.errorMessage || '—',
            },
            {
              id: 'actions',
              header: '',
              cell: ({ row }) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialog({ kind: row.original.kind, id: row.original.id })}
                >
                  查看
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
      {dialog && (
        <ImportDialog
          key={dialog.id || `new-${dialog.kind}`}
          open
          kind={dialog.kind}
          initialJobId={dialog.id}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
    </>
  );
}
