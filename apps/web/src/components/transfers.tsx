import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, fileUrl, post, queryClient, upload } from '../lib/api';
import { Button, DataTable, ErrorMessage, Input, Modal, Badge } from './ui';

export interface ImportJob {
  id: string;
  jobId: string;
  kind: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  phase: 'PREVIEW' | 'COMMIT';
  previewValid: boolean;
  rowCount: number;
  validRows: number;
  expectedNew: number;
  createdCount?: number;
  actorName?: string;
  canCommit?: boolean;
  duplicates: { row: number; field: string; message: string }[];
  errors: { row: number; field: string; message: string }[];
  errorMessage?: string;
  createdAt: string;
  committedAt?: string;
}
export const kindLabels: Record<string, string> = {
  customers: '客户',
  products: '产品',
  orders: '订单',
};
export const jobStatus: Record<string, string> = {
  QUEUED: '待处理',
  RUNNING: '处理中',
  SUCCEEDED: '成功',
  FAILED: '失败',
};

export function ExportButton({
  kind,
  filters,
}: {
  kind: string;
  filters: Record<string, unknown>;
}) {
  const [jobId, setJobId] = useState('');
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => post<{ jobId: string }>('/exports', { kind, filters }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setOpen(true);
    },
  });
  const job = useQuery({
    queryKey: ['export', jobId],
    queryFn: () =>
      api<{ status: string; rowCount: number; errorMessage?: string }>(`/exports/${jobId}`),
    enabled: !!jobId && open,
    refetchInterval: (query) =>
      query.state.data && ['SUCCEEDED', 'FAILED'].includes(query.state.data.status) ? false : 1500,
  });
  return (
    <>
      <Button pending={mutation.isPending} onClick={() => mutation.mutate()}>
        <Download size={15} />
        导出
      </Button>
      {mutation.error && <ErrorMessage error={mutation.error} />}
      <Modal open={open} onOpenChange={setOpen} title={`导出${kindLabels[kind]}`}>
        <div className="transfer-result">
          <FileSpreadsheet size={38} />
          <strong>{job.data ? jobStatus[job.data.status] : '处理中'}</strong>
          {job.data?.status === 'SUCCEEDED' && (
            <>
              <span>{job.data.rowCount} 条记录</span>
              <a
                className="button button-primary"
                href={fileUrl(`/exports/${jobId}/download`)}
                download
              >
                <Download size={16} />
                下载文件
              </a>
            </>
          )}
          <ErrorMessage error={job.error || job.data?.errorMessage} />
        </div>
      </Modal>
    </>
  );
}

export function ImportDialog({
  kind,
  open,
  onOpenChange,
  initialJobId,
}: {
  kind: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialJobId?: string;
}) {
  const [jobId, setJobId] = useState(initialJobId || '');
  const [filename, setFilename] = useState('');
  const [progress, setProgress] = useState(0);
  const [validation, setValidation] = useState('');
  const [duplicateAccepted, setDuplicateAccepted] = useState(false);
  const [errorPage, setErrorPage] = useState(1);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      return upload<{ jobId: string }>('/imports/preview', form, setProgress);
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  const job = useQuery({
    queryKey: ['import', jobId],
    queryFn: () => api<ImportJob>(`/imports/${jobId}`),
    enabled: !!jobId && open,
    refetchInterval: (query) =>
      query.state.data && ['SUCCEEDED', 'FAILED'].includes(query.state.data.status) ? false : 1500,
  });
  const commit = useMutation({
    mutationFn: () => post<{ jobId: string }>(`/imports/${jobId}/commit`, { idempotencyKey: key }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      void queryClient.invalidateQueries({ queryKey: ['import', data.jobId] });
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  const result = job.data;
  const complete = result?.phase === 'COMMIT' && result.status === 'SUCCEEDED';
  useEffect(() => {
    if (!complete) return;
    for (const queryKey of [
      [kind],
      ['imports'],
      ['dashboard'],
      ...(kind === 'orders' ? [['customers'], ['customer']] : []),
    ])
      void queryClient.invalidateQueries({ queryKey });
  }, [complete, result?.committedAt, kind]);
  const step = complete ? 4 : result?.phase === 'COMMIT' ? 3 : result ? 2 : 1;
  const errors = result?.errors || [];
  function selected(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setValidation('请选择 XLSX 文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setValidation('文件不能超过 20 MB');
      return;
    }
    setValidation('');
    setJobId('');
    setKey(crypto.randomUUID());
    setFilename(file.name);
    setDuplicateAccepted(false);
    setErrorPage(1);
    commit.reset();
    mutation.mutate(file);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`导入${kindLabels[kind]}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
          {result?.phase === 'PREVIEW' && result.previewValid && result.canCommit !== false && (
            <Button
              variant="primary"
              pending={commit.isPending}
              disabled={!!result.duplicates?.length && !duplicateAccepted}
              onClick={() => commit.mutate()}
            >
              <Check size={16} />
              确认导入 {result.expectedNew} 条
            </Button>
          )}
          {errors.length > 0 && (
            <a
              className="button button-outline"
              href={fileUrl(`/imports/${jobId}/errors`)}
              download
            >
              <Download size={15} />
              下载错误
            </a>
          )}
        </>
      }
    >
      <div className="import-steps">
        {['上传文件', '校验结果', '确认导入', '导入结果'].map((label, index) => (
          <div className={step >= index + 1 ? 'active' : ''} key={label}>
            <span>{step > index + 1 ? <Check size={12} /> : index + 1}</span>
            {label}
          </div>
        ))}
      </div>
      {!complete && result?.phase !== 'COMMIT' && (
        <div className="import-drop">
          <FileSpreadsheet size={31} />
          <label className="button button-outline">
            <Upload size={15} />
            {filename || '选择 XLSX 文件'}
            <Input
              type="file"
              accept=".xlsx"
              className="visually-hidden"
              onChange={(event) => selected(event.target.files?.[0])}
              disabled={mutation.isPending}
            />
          </label>
          <span>20 MB · 最多 5000 行</span>
          <a href={fileUrl(`/import-templates/${kind}`)} download className="text-link">
            <Download size={14} />
            下载模板
          </a>
          {mutation.isPending && <progress value={progress} max="100" />}
        </div>
      )}
      <ErrorMessage
        error={validation || mutation.error || job.error || commit.error || result?.errorMessage}
      />
      {result && (
        <>
          <div className="import-counts">
            <div>
              <span>总行数</span>
              <strong>{result.rowCount || 0}</strong>
            </div>
            <div>
              <span>有效行数</span>
              <strong>{result.validRows || 0}</strong>
            </div>
            <div>
              <span>错误行数</span>
              <strong>{new Set(errors.map((item) => item.row)).size}</strong>
            </div>
          </div>
          {['QUEUED', 'RUNNING'].includes(result.status) && <Badge>处理中</Badge>}
          {errors.length > 0 && (
            <>
              <DataTable
                data={errors.slice((errorPage - 1) * 50, errorPage * 50)}
                columns={[
                  { accessorKey: 'row', header: '行号' },
                  { accessorKey: 'field', header: '字段' },
                  { accessorKey: 'message', header: '错误' },
                ]}
              />
              <div className="inline-actions">
                <Button
                  size="sm"
                  disabled={errorPage <= 1}
                  onClick={() => setErrorPage(errorPage - 1)}
                >
                  上一页
                </Button>
                <span>
                  {errorPage} / {Math.ceil(errors.length / 50)}
                </span>
                <Button
                  size="sm"
                  disabled={errorPage * 50 >= errors.length}
                  onClick={() => setErrorPage(errorPage + 1)}
                >
                  下一页
                </Button>
              </div>
            </>
          )}
          {result.duplicates?.length > 0 && (
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={duplicateAccepted}
                onChange={(event) => setDuplicateAccepted(event.target.checked)}
              />
              可能重复 {result.duplicates.length} 条，确认新增
            </label>
          )}
          {complete && (
            <div className="transfer-result">
              <span className="success-check">
                <Check size={24} />
              </span>
              <strong>导入成功</strong>
              <span>新增 {result.createdCount ?? result.expectedNew} 条</span>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
