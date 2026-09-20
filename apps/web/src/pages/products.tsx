import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Package, Plus, Upload } from 'lucide-react';
import { api, patch, post, queryClient, queryString } from '../lib/api';
import { useListState, useOptions } from '../lib/hooks';
import { useSession } from '../lib/session';
import { date, money, useDirtyGuard } from '../lib/utils';
import type { Page, Product } from '../lib/types';
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
import { ExportButton, ImportDialog } from '../components/transfers';

export default function Products() {
  const { user } = useSession();
  const list = useListState();
  const [drawer, setDrawer] = useState<{ id?: string; edit: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dictionary, setDictionary] = useState('');
  const categories = useOptions('product-category');
  const query = useQuery({
    queryKey: ['products', list.params],
    queryFn: ({ signal }) =>
      api<Page<Product>>(`/products?${queryString(list.params)}`, { signal }),
  });
  const archive = useMutation({
    mutationFn: (item: Product) =>
      post(`/products/${item.id}/${item.archivedAt ? 'restore' : 'archive'}`, {
        version: item.version,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product-options'] });
    },
  });
  return (
    <>
      <PageHeading
        title="产品清单"
        count={query.data?.total}
        actions={
          <>
            <ExportButton kind="products" filters={list.params} />
            <Button onClick={() => setImportOpen(true)}>
              <Upload size={15} />
              导入
            </Button>
            <Button variant="primary" onClick={() => setDrawer({ edit: true })}>
              <Plus size={16} />
              新增产品
            </Button>
          </>
        }
      />
      <div className="panel">
        <div className="table-toolbar">
          <SearchInput label="搜索产品名称、编号" value={list.search} onChange={list.setSearch} />
          <Select
            aria-label="产品分类"
            value={list.filters.categoryId || ''}
            onChange={(event) => list.filter('categoryId', event.target.value)}
          >
            <option value="">全部分类</option>
            {categories.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="归档状态"
            value={list.filters.archived || ''}
            onChange={(event) => list.filter('archived', event.target.value)}
          >
            <option value="">未归档</option>
            <option value="true">已归档</option>
          </Select>
          <div className="toolbar-spacer" />
          <Button variant="ghost" onClick={() => setDictionary('product-category')}>
            分类管理
          </Button>
          <Button variant="ghost" onClick={() => setDictionary('product-tag')}>
            标签管理
          </Button>
        </div>
        <ErrorMessage error={archive.error} />
        <DataTable
          data={query.data?.items || []}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          columns={[
            {
              accessorKey: 'name',
              header: '产品名称',
              cell: ({ row }) => (
                <div className="company-cell">
                  <span className="product-icon">
                    <Package size={19} />
                  </span>
                  <div>
                    <button
                      className="text-button cell-strong"
                      onClick={() => setDrawer({ id: row.original.id, edit: false })}
                    >
                      {row.original.name}
                    </button>
                    <small>{row.original.model || '—'}</small>
                  </div>
                </div>
              ),
            },
            {
              accessorKey: 'sku',
              header: '产品编号 / SKU',
              cell: ({ row }) => <span className="tabular">{row.original.sku}</span>,
            },
            {
              accessorKey: 'categoryName',
              header: '分类',
              cell: ({ row }) => row.original.categoryName || '—',
            },
            { accessorKey: 'unit', header: '单位' },
            {
              accessorKey: 'priceExTax',
              header: '不含税单价（元）',
              cell: ({ row }) => <span className="amount">{money(row.original.priceExTax)}</span>,
            },
            {
              id: 'status',
              header: '状态',
              cell: ({ row }) => (
                <Badge tone={row.original.archivedAt ? 'neutral' : 'green'}>
                  {row.original.archivedAt ? '已归档' : '在售'}
                </Badge>
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
              cell: ({ row: { original: item } }) => (
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawer({ id: item.id, edit: true })}
                  >
                    编辑
                  </Button>
                  {user.role === 'BOSS' && (
                    <Menu
                      items={[
                        {
                          label: item.archivedAt ? '恢复' : '归档',
                          danger: !item.archivedAt,
                          onClick: () => {
                            if (confirm(`确认${item.archivedAt ? '恢复' : '归档'}“${item.name}”？`))
                              archive.mutate(item);
                          },
                        },
                      ]}
                    />
                  )}
                </div>
              ),
            },
          ]}
          emptyAction={
            <Button size="sm" onClick={() => setDrawer({ edit: true })}>
              <Plus size={14} />
              新增产品
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
        <ProductDrawer
          key={`${drawer.id}-${drawer.edit}`}
          {...drawer}
          onClose={() => setDrawer(null)}
          onEdit={() => setDrawer({ ...drawer, edit: true })}
        />
      )}
      {importOpen && <ImportDialog kind="products" open onOpenChange={setImportOpen} />}
      <DictionaryManager
        key={dictionary}
        open={!!dictionary}
        onOpenChange={(open) => {
          if (!open) setDictionary('');
        }}
        kind={dictionary}
        title={dictionary === 'product-category' ? '产品分类' : '产品标签'}
      />
    </>
  );
}

function ProductDrawer({
  id,
  edit,
  onClose,
  onEdit,
}: {
  id?: string;
  edit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const query = useQuery({
    queryKey: ['product', id],
    queryFn: () => api<Product>(`/products/${id}`),
    enabled: !!id,
  });
  const categories = useOptions('product-category');
  const tags = useOptions('product-tag');
  const assets = useQuery({
    queryKey: ['product-assets', id, query.data?.assetIds],
    queryFn: async () => ({
      items: await Promise.all(
        (query.data?.assetIds || []).map((assetId) =>
          api<{ id: string; name: string }>(`/assets/${assetId}`),
        ),
      ),
    }),
    enabled: !!query.data && !edit,
  });
  const [form, setForm] = useState({
    name: '',
    sku: '',
    model: '',
    unit: '件',
    priceExTax: '0.00',
    categoryId: '',
    tagIds: [] as string[],
    assetIds: [] as string[],
  });
  const [dirty, setDirty] = useState(false);
  useDirtyGuard(dirty);
  useEffect(() => {
    if (query.data) {
      const item = query.data;
      setForm({
        name: item.name,
        sku: item.sku,
        model: item.model || '',
        unit: item.unit,
        priceExTax: item.priceExTax,
        categoryId: item.categoryId || '',
        tagIds: item.tagIds || [],
        assetIds: item.assetIds || [],
      });
    }
  }, [query.data]);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }
  function close() {
    if (!dirty || confirm('有未保存的修改，确认关闭？')) onClose();
  }
  const save = useMutation({
    mutationFn: () => {
      const data = { ...form, categoryId: form.categoryId || null };
      return id
        ? patch(`/products/${id}`, { ...data, version: query.data?.version })
        : post('/products', data);
    },
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product-options'] });
      onClose();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={!id ? '新增产品' : edit ? '编辑产品' : query.data?.name || '产品详情'}
      footer={
        edit ? (
          <>
            <span className="save-status">{dirty ? '未保存' : ''}</span>
            <Button onClick={close}>取消</Button>
            <Button form="product-form" type="submit" variant="primary" pending={save.isPending}>
              保存
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onEdit}>
            编辑产品
          </Button>
        )
      }
    >
      {id && query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorMessage error={query.error} />
      ) : edit ? (
        <form
          id="product-form"
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
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
          <div className="form-section">
            <h3>产品信息</h3>
            <div className="form-grid">
              <Field label="产品名称" required className="span-two">
                <Input
                  value={form.name}
                  required
                  maxLength={200}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>
              <Field label="产品编号 / SKU" required>
                <Input
                  value={form.sku}
                  required
                  maxLength={100}
                  onChange={(event) => update('sku', event.target.value)}
                />
              </Field>
              <Field label="规格型号">
                <Input
                  value={form.model}
                  maxLength={200}
                  onChange={(event) => update('model', event.target.value)}
                />
              </Field>
              <Field label="单位" required>
                <Input
                  value={form.unit}
                  required
                  maxLength={20}
                  onChange={(event) => update('unit', event.target.value)}
                />
              </Field>
              <Field label="不含税单价（元）" required>
                <Input
                  inputMode="decimal"
                  value={form.priceExTax}
                  required
                  pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                  onChange={(event) => update('priceExTax', event.target.value)}
                />
              </Field>
              <Field label="分类">
                <Select
                  value={form.categoryId}
                  onChange={(event) => update('categoryId', event.target.value)}
                >
                  <option value="">未分类</option>
                  {categories.data?.items.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="标签">
                <MultiSelect
                  options={tags.data?.items || []}
                  value={form.tagIds}
                  onChange={(value) => update('tagIds', value)}
                  label="产品标签"
                />
              </Field>
              <Field label="关联资料" className="span-two">
                <EntitySelect
                  resource="assets"
                  label="资料"
                  multiple
                  value={form.assetIds}
                  onChange={(value) => update('assetIds', value)}
                />
              </Field>
            </div>
          </div>
        </form>
      ) : (
        query.data && (
          <>
            <div className="detail-identity">
              <span className="product-icon large">
                <Package size={25} />
              </span>
              <div>
                <strong>{query.data.name}</strong>
                <small>{query.data.sku}</small>
              </div>
              <Badge tone={query.data.archivedAt ? 'neutral' : 'green'}>
                {query.data.archivedAt ? '已归档' : '在售'}
              </Badge>
            </div>
            <DetailList
              values={[
                ['产品编号 / SKU', query.data.sku],
                ['规格型号', query.data.model],
                ['单位', query.data.unit],
                ['不含税单价', `¥ ${money(query.data.priceExTax)}`],
                ['分类', query.data.categoryName],
                ['标签', query.data.tags?.map((item) => item.name).join('、')],
                ['更新时间', date(query.data.updatedAt, true)],
              ]}
            />
            <h3 className="detail-section-title">关联资料</h3>
            <div className="linked-assets">
              {assets.data?.items
                .filter((item) => query.data!.assetIds?.includes(item.id))
                .map((item) => (
                  <a key={item.id} href={`/materials?assetId=${item.id}`} className="text-link">
                    {item.name}
                  </a>
                ))}
            </div>
          </>
        )
      )}
    </Sheet>
  );
}
