import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  Download,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Grid2X2,
  Link2,
  List,
  Plus,
  RefreshCw,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { api, fileUrl, patch, post, queryClient, queryString, upload } from '../lib/api';
import { useListState, useOptions } from '../lib/hooks';
import { useSession } from '../lib/session';
import { date, size, useDirtyGuard } from '../lib/utils';
import type { Entity, Option, Page, Product } from '../lib/types';
import {
  Badge,
  Button,
  ConflictActions,
  DataTable,
  DetailList,
  Empty,
  ErrorMessage,
  Field,
  Input,
  Menu,
  MultiSelect,
  PageHeading,
  Pagination,
  SearchInput,
  Select,
  Sheet,
} from '../components/ui';
import { DictionaryManager } from '../components/dictionary';
import { EntitySelect } from '../components/entity-select';

interface Asset extends Entity {
  name: string;
  description: string;
  categoryId: string | null;
  categoryName: string;
  tagIds: string[];
  tags: Option[];
  productIds: string[];
  products: Product[];
  currentVersionId: string;
  originalName: string;
  mediaType: string;
  bytes: number;
  canDownload?: boolean;
  versions?: {
    id: string;
    originalName: string;
    mediaType: string;
    bytes: number;
    createdAt: string;
  }[];
}
const extensions = '.pdf,.png,.jpg,.jpeg,.webp,.mp4,.docx,.xlsx,.pptx';
function AssetIcon({ type, size: pixels = 23 }: { type: string; size?: number }) {
  const Icon = type.startsWith('image/')
    ? FileImage
    : type.startsWith('video/')
      ? Video
      : type.includes('pdf')
        ? FileText
        : type.includes('sheet')
          ? FileSpreadsheet
          : File;
  return <Icon size={pixels} strokeWidth={1.6} />;
}
function mediaLabel(type: string) {
  if (type.startsWith('image/')) return '图片';
  if (type.startsWith('video/')) return '视频';
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('sheet')) return '表格';
  if (type.includes('presentation')) return '演示文稿';
  return '文档';
}

export default function Materials() {
  const { user } = useSession();
  const list = useListState();
  const [grid, setGrid] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [assetId, setAssetId] = useState(list.filters.assetId || '');
  const [dictionary, setDictionary] = useState('');
  const categories = useOptions('asset-category');
  const tags = useOptions('asset-tag');
  const query = useQuery({
    queryKey: ['assets', list.params],
    queryFn: ({ signal }) => api<Page<Asset>>(`/assets?${queryString(list.params)}`, { signal }),
  });
  const archive = useMutation({
    mutationFn: (asset: Asset) =>
      post(`/assets/${asset.id}/${asset.archivedAt ? 'restore' : 'archive'}`, {
        version: asset.version,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets'] }),
  });
  const [copyError, setCopyError] = useState('');
  function actions(item: Asset) {
    return [
      { label: '查看资料', onClick: () => setAssetId(item.id) },
      {
        label: '复制内部链接',
        onClick: () => {
          void navigator.clipboard
            .writeText(`${window.location.origin}/materials?assetId=${item.id}`)
            .catch(() => setCopyError('复制失败'));
        },
      },
      ...(user.role === 'BOSS'
        ? [
            {
              label: item.archivedAt ? '恢复' : '归档',
              danger: !item.archivedAt,
              onClick: () => {
                if (confirm(`确认${item.archivedAt ? '恢复' : '归档'}“${item.name}”？`))
                  archive.mutate(item);
              },
            },
          ]
        : []),
    ];
  }
  return (
    <>
      <PageHeading
        title="资料库"
        count={query.data?.total}
        actions={
          <Button variant="primary" onClick={() => setUploadOpen(true)}>
            <Upload size={16} />
            上传资料
          </Button>
        }
      />
      <div className="materials-layout">
        <aside className="category-panel">
          <div className="section-heading">
            <h2>分类</h2>
            <Button
              size="icon"
              variant="ghost"
              aria-label="分类管理"
              onClick={() => setDictionary('asset-category')}
            >
              <Plus size={15} />
            </Button>
          </div>
          <button
            className={!list.filters.categoryId ? 'active' : ''}
            onClick={() => list.filter('categoryId', '')}
          >
            <FolderOpen size={16} />
            全部资料
          </button>
          {categories.data?.items.map((item) => (
            <button
              key={item.id}
              className={list.filters.categoryId === item.id ? 'active' : ''}
              onClick={() => list.filter('categoryId', item.id)}
            >
              <FolderOpen size={16} />
              {item.name}
            </button>
          ))}
          <div className="category-bottom">
            <Button variant="ghost" onClick={() => setDictionary('asset-tag')}>
              标签管理
            </Button>
          </div>
        </aside>
        <div className="panel material-content">
          <div className="table-toolbar">
            <SearchInput value={list.search} onChange={list.setSearch} label="搜索资料名称" />
            <Select
              aria-label="资料类型"
              value={list.filters.mediaType || ''}
              onChange={(event) => list.filter('mediaType', event.target.value)}
            >
              <option value="">全部类型</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="application/pdf">PDF</option>
              <option value="document">文档</option>
            </Select>
            <Select
              aria-label="资料标签"
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
            <div className="toolbar-spacer" />
            <div className="segmented">
              <Button
                size="icon"
                variant={!grid ? 'outline' : 'ghost'}
                aria-label="列表视图"
                aria-pressed={!grid}
                onClick={() => setGrid(false)}
              >
                <List size={16} />
              </Button>
              <Button
                size="icon"
                variant={grid ? 'outline' : 'ghost'}
                aria-label="网格视图"
                aria-pressed={grid}
                onClick={() => setGrid(true)}
              >
                <Grid2X2 size={16} />
              </Button>
            </div>
          </div>
          <div className="extended-filters material-filters">
            <EntitySelect
              resource="products"
              label="关联产品"
              value={list.filters.productId || ''}
              onChange={(value) => list.filter('productId', value)}
            />
            {user.role === 'BOSS' && (
              <Select
                aria-label="归档状态"
                value={list.filters.archived || ''}
                onChange={(event) => list.filter('archived', event.target.value)}
              >
                <option value="">未归档</option>
                <option value="true">已归档</option>
              </Select>
            )}
            {list.filters.customerId && (
              <Button variant="ghost" onClick={() => list.filter('customerId', '')}>
                取消客户匹配 <X size={13} />
              </Button>
            )}
          </div>
          <ErrorMessage error={archive.error || copyError} />
          {grid ? (
            <>
              {query.error && (
                <ErrorMessage error={query.error} retry={() => void query.refetch()} />
              )}
              <div className="asset-grid">
                {query.data?.items.map((item) => (
                  <article className="asset-card" key={item.id}>
                    <button
                      className={`asset-thumbnail media-${mediaLabel(item.mediaType)}`}
                      onClick={() => setAssetId(item.id)}
                      aria-label={`预览${item.name}`}
                    >
                      {item.mediaType.startsWith('image/') ? (
                        <img
                          loading="lazy"
                          src={fileUrl(`/assets/${item.id}/preview`)}
                          alt={item.name}
                        />
                      ) : (
                        <AssetIcon type={item.mediaType} size={45} />
                      )}
                    </button>
                    <div className="asset-card-info">
                      <div>
                        <button
                          className="text-button cell-strong"
                          onClick={() => setAssetId(item.id)}
                        >
                          {item.name}
                        </button>
                        <small>
                          {mediaLabel(item.mediaType)} · {size(item.bytes)}
                        </small>
                      </div>
                      <Menu items={actions(item)} />
                    </div>
                    <div className="tag-list asset-card-tags">
                      {item.tags?.map((tag) => (
                        <span className="tag" key={tag.id}>
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {!query.isPending && !query.data?.items.length && !query.error && <Empty />}
            </>
          ) : (
            <DataTable
              data={query.data?.items || []}
              loading={query.isPending}
              error={query.error}
              onRetry={() => void query.refetch()}
              columns={[
                {
                  accessorKey: 'name',
                  header: '文件名称',
                  cell: ({ row: { original: item } }) => (
                    <div className="company-cell">
                      <span className="file-icon">
                        <AssetIcon type={item.mediaType} />
                      </span>
                      <div>
                        <button
                          className="text-button cell-strong"
                          onClick={() => setAssetId(item.id)}
                        >
                          {item.name}
                        </button>
                        <small>{item.originalName}</small>
                      </div>
                    </div>
                  ),
                },
                {
                  accessorKey: 'mediaType',
                  header: '类型',
                  cell: ({ row }) => mediaLabel(row.original.mediaType),
                },
                {
                  accessorKey: 'bytes',
                  header: '大小',
                  cell: ({ row }) => size(row.original.bytes),
                },
                {
                  accessorKey: 'categoryName',
                  header: '分类',
                  cell: ({ row }) => row.original.categoryName || '未分类',
                },
                {
                  id: 'tags',
                  header: '标签',
                  cell: ({ row }) => (
                    <div className="tag-list">
                      {row.original.tags?.map((tag) => (
                        <span className="tag" key={tag.id}>
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ),
                },
                {
                  accessorKey: 'updatedAt',
                  header: '更新时间',
                  cell: ({ row }) => date(row.original.updatedAt, true),
                },
                {
                  id: 'actions',
                  header: '',
                  cell: ({ row }) => (
                    <div className="row-actions">
                      <a
                        className="button button-ghost button-icon"
                        aria-label={`下载${row.original.name}`}
                        href={fileUrl(`/assets/${row.original.id}/download`)}
                        download
                      >
                        <Download size={16} />
                      </a>
                      <Menu items={actions(row.original)} />
                    </div>
                  ),
                },
              ]}
            />
          )}
          <Pagination
            total={query.data?.total || 0}
            page={list.page}
            pageSize={list.pageSize}
            onPage={list.setPage}
            onPageSize={list.setPageSize}
          />
        </div>
      </div>
      {uploadOpen && <UploadDrawer onClose={() => setUploadOpen(false)} />}
      {assetId && (
        <AssetDrawer
          id={assetId}
          onClose={() => {
            setAssetId('');
            if (list.filters.assetId) list.filter('assetId', '');
          }}
        />
      )}
      <DictionaryManager
        key={dictionary}
        kind={dictionary}
        open={!!dictionary}
        onOpenChange={(open) => {
          if (!open) setDictionary('');
        }}
        title={dictionary === 'asset-category' ? '资料分类' : '资料标签'}
      />
    </>
  );
}

interface UploadItem {
  id: string;
  file: File;
  progress: number;
  state: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  controller?: AbortController;
}
function UploadDrawer({ onClose }: { onClose: () => void }) {
  const categories = useOptions('asset-category');
  const tags = useOptions('asset-tag');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef(items);
  const cancelled = useRef(false);
  const cancelledItems = useRef(new Set<string>());
  itemsRef.current = items;
  const [dragging, setDragging] = useState(false);
  const pending = items.some((item) => item.state === 'running');
  useDirtyGuard(pending);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      itemsRef.current.forEach((item) => item.controller?.abort());
    };
  }, []);
  function update(id: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  async function send(item: UploadItem) {
    if (cancelled.current || cancelledItems.current.has(item.id)) return;
    if (item.file.size > 200 * 1024 * 1024) {
      update(item.id, { state: 'failed', error: '文件不能超过 200 MB' });
      return;
    }
    if (!/\.(pdf|png|jpe?g|webp|mp4|docx|xlsx|pptx)$/i.test(item.file.name)) {
      update(item.id, { state: 'failed', error: '文件格式不支持' });
      return;
    }
    const controller = new AbortController();
    update(item.id, { state: 'running', progress: 0, error: '', controller });
    const form = new FormData();
    form.set('file', item.file);
    form.set(
      'metadata',
      JSON.stringify({
        name: item.file.name.replace(/\.[^.]+$/, ''),
        description: '',
        categoryId: categoryId || null,
        tagIds,
        productIds,
      }),
    );
    try {
      await upload('/assets', form, (progress) => update(item.id, { progress }), controller.signal);
      update(item.id, { state: 'done', progress: 100 });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    } catch (error) {
      update(item.id, {
        state: 'failed',
        error: error instanceof Error ? error.message : '上传失败',
      });
    }
  }
  async function select(files: FileList | File[]) {
    const added = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      state: 'queued' as const,
    }));
    setItems((current) => [...current, ...added]);
    for (const item of added) {
      if (cancelled.current) break;
      await send(item);
    }
  }
  function close() {
    if (!pending || confirm('文件正在上传，确认取消并关闭？')) {
      cancelled.current = true;
      items.forEach((item) => item.controller?.abort());
      onClose();
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="上传资料"
      footer={<Button onClick={close}>完成</Button>}
    >
      <div className="form-stack">
        <Field label="分类">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">未分类</option>
            {categories.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="标签">
          <MultiSelect
            label="资料标签"
            options={tags.data?.items || []}
            value={tagIds}
            onChange={setTagIds}
          />
        </Field>
        <Field label="关联产品">
          <EntitySelect
            resource="products"
            label="关联产品"
            multiple
            value={productIds}
            onChange={setProductIds}
          />
        </Field>
        <div
          className={`upload-drop ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void select(event.dataTransfer.files);
          }}
        >
          <span className="upload-drop-icon">
            <Upload size={26} />
          </span>
          <label className="button button-outline">
            选择文件
            <Input
              className="visually-hidden"
              type="file"
              multiple
              accept={extensions}
              onChange={(event) => {
                if (event.target.files) void select(event.target.files);
              }}
            />
          </label>
          <span>或拖放文件至此</span>
          <small>单文件最大 200 MB</small>
        </div>
        <div className="upload-list">
          {items.map((item) => (
            <div className="upload-item" key={item.id}>
              <span className="file-icon">
                <AssetIcon type={item.file.type} />
              </span>
              <div>
                <strong>{item.file.name}</strong>
                <small>
                  {size(item.file.size)} ·{' '}
                  {item.state === 'done'
                    ? '已上传'
                    : item.state === 'failed'
                      ? item.error
                      : item.state === 'queued'
                        ? '待上传'
                        : `${item.progress}%`}
                </small>
                {item.state === 'running' && <progress value={item.progress} max="100" />}
              </div>
              {item.state === 'done' ? (
                <Check className="text-success" size={18} />
              ) : item.state === 'failed' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="重新上传"
                  onClick={() => {
                    cancelledItems.current.delete(item.id);
                    void send(item);
                  }}
                >
                  <RefreshCw size={16} />
                </Button>
              ) : item.state === 'running' || item.state === 'queued' ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="取消上传"
                  onClick={() => {
                    cancelledItems.current.add(item.id);
                    item.controller?.abort();
                    update(item.id, { state: 'failed', error: '已取消' });
                  }}
                >
                  <X size={16} />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function AssetDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['asset', id], queryFn: () => api<Asset>(`/assets/${id}`) });
  const categories = useOptions('asset-category');
  const tags = useOptions('asset-tag');
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [versionId, setVersionId] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    categoryId: '',
    tagIds: [] as string[],
    productIds: [] as string[],
  });
  const [progress, setProgress] = useState(0);
  useDirtyGuard(dirty);
  useEffect(() => {
    if (query.data)
      setForm({
        name: query.data.name,
        description: query.data.description || '',
        categoryId: query.data.categoryId || '',
        tagIds: query.data.tagIds || [],
        productIds: query.data.productIds || [],
      });
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      patch(`/assets/${id}`, {
        ...form,
        categoryId: form.categoryId || null,
        version: query.data?.version,
      }),
    onSuccess: () => {
      setDirty(false);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
    },
  });
  const replace = useMutation({
    mutationFn: (file: File) => {
      if (file.size > 200 * 1024 * 1024) throw new Error('文件不能超过 200 MB');
      const data = new FormData();
      data.set('file', file);
      data.set('version', String(query.data?.version));
      return upload(`/assets/${id}/versions`, data, setProgress);
    },
    onSuccess: () => {
      setVersionId('');
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
    },
  });
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }
  function close() {
    if (!dirty || confirm('有未保存的修改，确认关闭？')) onClose();
  }
  const asset = query.data;
  const chosenVersion = asset?.versions?.find((version) => version.id === versionId);
  const media = chosenVersion?.mediaType || asset?.mediaType || '';
  const url = fileUrl(`/assets/${id}/preview${versionId ? `?versionId=${versionId}` : ''}`);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={editing ? '编辑资料' : asset?.name || '资料详情'}
      wide
      footer={
        asset?.canDownload === false ? undefined : editing ? (
          <>
            <Button
              onClick={() => {
                if (!dirty || confirm('放弃当前修改？')) {
                  setEditing(false);
                  setDirty(false);
                }
              }}
            >
              取消
            </Button>
            <Button variant="primary" type="submit" form="asset-form" pending={save.isPending}>
              保存
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEditing(true)}>编辑资料</Button>
            <a
              className="button button-primary"
              href={fileUrl(`/assets/${id}/download${versionId ? `?versionId=${versionId}` : ''}`)}
              download
            >
              <Download size={15} />
              下载
            </a>
          </>
        )
      }
    >
      <ErrorMessage error={query.error || save.error || replace.error || copyError} />
      <ConflictActions
        error={save.error || replace.error}
        onReload={() => {
          setDirty(false);
          save.reset();
          replace.reset();
          void query.refetch();
        }}
        onKeep={() => {
          save.reset();
          replace.reset();
        }}
      />
      {asset &&
        (editing ? (
          <form
            id="asset-form"
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="资料名称" required>
              <Input
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
              />
            </Field>
            <Field label="资料说明">
              <textarea
                className="input"
                rows={3}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </Field>
            <Field label="分类">
              <Select
                value={form.categoryId}
                onChange={(event) => update('categoryId', event.target.value)}
              >
                <option value="">未分类</option>
                {categories.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="标签">
              <MultiSelect
                label="资料标签"
                options={tags.data?.items || []}
                value={form.tagIds}
                onChange={(value) => update('tagIds', value)}
              />
            </Field>
            <Field label="关联产品">
              <EntitySelect
                resource="products"
                label="关联产品"
                multiple
                value={form.productIds}
                onChange={(value) => update('productIds', value)}
              />
            </Field>
          </form>
        ) : (
          <>
            <div className="asset-preview">
              {asset.canDownload === false ? (
                <Badge>已归档</Badge>
              ) : media.startsWith('image/') ? (
                <img src={url} alt={asset.name} />
              ) : media === 'application/pdf' ? (
                <iframe title={asset.name} src={url} />
              ) : media.startsWith('video/') ? (
                <video src={url} controls preload="none" />
              ) : (
                <div className="preview-download">
                  <AssetIcon type={media} size={64} />
                  <span>{chosenVersion?.originalName || asset.originalName}</span>
                  <a
                    href={fileUrl(
                      `/assets/${id}/download${versionId ? `?versionId=${versionId}` : ''}`,
                    )}
                    download
                    className="button button-outline"
                  >
                    <Download size={15} />
                    下载文件
                  </a>
                </div>
              )}
            </div>
            <div className="inline-actions asset-detail-actions">
              <Badge>{mediaLabel(media)}</Badge>
              <span>{size(chosenVersion?.bytes || asset.bytes)}</span>
              <div className="toolbar-spacer" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(`${window.location.origin}/materials?assetId=${id}`)
                    .then(() => setCopied(true))
                    .catch(() => setCopyError('复制失败'));
                }}
              >
                <Link2 size={14} />
                {copied ? '已复制' : '复制链接'}
              </Button>
              {asset.canDownload !== false && (
                <label className="button button-outline button-sm">
                  <RefreshCw size={14} />
                  替换文件
                  <Input
                    type="file"
                    accept={extensions}
                    className="visually-hidden"
                    disabled={replace.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && confirm(`确认用“${file.name}”替换当前文件？`))
                        replace.mutate(file);
                    }}
                  />
                </label>
              )}
            </div>
            {replace.isPending && <progress value={progress} max="100" />}
            <DetailList
              values={[
                ['文件名', asset.originalName],
                ['分类', asset.categoryName],
                ['标签', asset.tags?.map((tag) => tag.name).join('、')],
                ['关联产品', asset.products?.map((product) => product.name).join('、')],
                ['更新时间', date(asset.updatedAt, true)],
              ]}
            />
            {asset.description && <p className="business-note">{asset.description}</p>}
            <h3 className="detail-section-title">文件版本</h3>
            <div className="asset-versions">
              {asset.versions?.map((version) => (
                <div key={version.id}>
                  <button className="text-link" onClick={() => setVersionId(version.id)}>
                    {date(version.createdAt, true)}
                  </button>
                  <span>{version.originalName}</span>
                  {version.id === asset.currentVersionId && <Badge tone="green">当前版本</Badge>}
                  {asset.canDownload !== false && (
                    <a
                      className="button button-ghost button-icon"
                      aria-label={`下载${date(version.createdAt, true)}版本`}
                      href={fileUrl(`/assets/${id}/download?versionId=${version.id}`)}
                      download
                    >
                      <Download size={15} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        ))}
    </Sheet>
  );
}
