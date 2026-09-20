import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { cn } from '../lib/utils';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'outline' | 'ghost' | 'danger';
    size?: 'default' | 'sm' | 'icon';
    pending?: boolean;
  }
>(
  (
    {
      className,
      variant = 'outline',
      size = 'default',
      pending,
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn('button', `button-${variant}`, `button-${size}`, className)}
      disabled={disabled || pending}
      {...props}
    >
      {pending && <LoaderCircle className="spin" size={16} />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('input', className)} {...props} />
  ),
);
Input.displayName = 'Input';
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('select-wrap', className)}>
      <select {...props}>{children}</select>
      <ChevronDown size={14} />
    </span>
  );
}
export function Field({
  label,
  children,
  required,
  className,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label className={cn('field', className)} id={id}>
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {children}
    </label>
  );
}
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const color =
    tone ||
    (children === '已付款' || children === 'ACTIVE' || children === '成功'
      ? 'green'
      : children === '待付款' || children === '待跟进'
        ? 'amber'
        : children === '已报价'
          ? 'blue'
          : 'neutral');
  return (
    <span className={`badge badge-${color}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function ErrorMessage({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={16} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && (
        <Button size="sm" variant="ghost" onClick={retry}>
          重试
        </Button>
      )}
    </div>
  );
}
export function Empty({ label = '暂无记录', action }: { label?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={27} strokeWidth={1.5} />
      </span>
      <span>{label}</span>
      {action}
    </div>
  );
}
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" role="status" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function PageHeading({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="heading-line">
          <h1>{title}</h1>
          {count !== undefined && <span className="count-tag">{count.toLocaleString()}</span>}
        </div>
        {children}
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function SearchInput({
  value,
  onChange,
  label = '搜索',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className={cn('search-input', className)}>
      <Search size={17} />
      <Input
        aria-label={label}
        placeholder={label}
        value={composing ? draft : value}
        onCompositionStart={(event) => {
          setDraft(event.currentTarget.value);
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          setComposing(false);
          onChange(event.currentTarget.value);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!composing) onChange(event.target.value);
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="清空搜索"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={cn('sheet', wide && 'sheet-wide')}
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
        >
          <div className="sheet-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="关闭">
                <X size={19} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="modal"
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
        >
          <div className="sheet-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="关闭">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="sheet-footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function useReturnFocus(open: boolean) {
  const wasOpen = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  if (open && !wasOpen.current) trigger.current = document.activeElement as HTMLElement;
  wasOpen.current = open;
  return (event: Event) => {
    if (trigger.current?.isConnected) {
      event.preventDefault();
      trigger.current.focus();
    }
  };
}
export function ConflictActions({
  error,
  onReload,
  onKeep,
}: {
  error: unknown;
  onReload: () => void;
  onKeep: () => void;
}) {
  if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 409)
    return null;
  return (
    <div className="inline-actions conflict-actions">
      <Button
        size="sm"
        onClick={() => {
          if (confirm('重新加载将放弃当前修改，确认继续？')) onReload();
        }}
      >
        重新加载
      </Button>
      <Button size="sm" variant="ghost" onClick={onKeep}>
        保留编辑
      </Button>
    </div>
  );
}
export function Menu({
  items,
  label = '操作',
}: {
  label?: string;
  items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[];
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button size="icon" variant="ghost" aria-label={label}>
          <MoreHorizontal size={18} />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu-content" sideOffset={6} align="end">
          {items.map((item, i) => (
            <Dropdown.Item
              className={cn('menu-item', item.danger && 'text-danger')}
              key={i}
              onSelect={item.onClick}
              disabled={item.disabled}
            >
              {item.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function InfoPopover({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="text-popover" type="button">
          {label}
          <ChevronDown size={13} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover-content" sideOffset={8} align="start">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function MultiSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  label: string;
}) {
  const [q, setQ] = useState('');
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="input multiselect-trigger" type="button" aria-label={label}>
          <span>
            {value.length
              ? options
                  .filter((option) => value.includes(option.id))
                  .map((option) => option.name)
                  .join('、') || `已选 ${value.length} 项`
              : `选择${label}`}
          </span>
          <ChevronsUpDown size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover-content multiselect" sideOffset={5} align="start">
          <SearchInput label={`搜索${label}`} value={q} onChange={setQ} />
          <div className="multi-options">
            {options
              .filter((option) => option.name.toLowerCase().includes(q.toLowerCase()))
              .map((option) => (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={value.includes(option.id)}
                  key={option.id}
                  onClick={() =>
                    onChange(
                      value.includes(option.id)
                        ? value.filter((id) => id !== option.id)
                        : [...value, option.id],
                    )
                  }
                >
                  <span className={cn('check-box', value.includes(option.id) && 'checked')}>
                    {value.includes(option.id) && <Check size={12} />}
                  </span>
                  {option.name}
                </button>
              ))}
            {!options.length && <Empty label="暂无选项" />}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function DataTable<T>({
  data,
  columns,
  loading,
  error,
  onRetry,
  emptyAction,
  compact,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyAction?: ReactNode;
  compact?: boolean;
}) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  if (error) return <ErrorMessage error={error} retry={onRetry} />;
  return (
    <div className={cn('table-scroll', compact && 'table-compact')}>
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} style={{ width: header.column.columnDef.size }}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <Loading />
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {!loading && data.length === 0 && <Empty action={emptyAction} />}
    </div>
  );
}
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (value: number) => void;
  onPageSize: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>共 {total.toLocaleString()} 条</span>
      <div>
        <Select
          aria-label="每页条数"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {[20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} 条 / 页
            </option>
          ))}
        </Select>
        <span className="page-number">
          {page} / {pages}
        </span>
        <Button
          size="icon"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          size="icon"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
export function DetailList({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="detail-list">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel section-panel', className)}>
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
