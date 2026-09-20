import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, LoaderCircle, X } from 'lucide-react';
import { api, queryString } from '../lib/api';
import { cn, useDebounce } from '../lib/utils';
import { Button, ErrorMessage, SearchInput } from './ui';
import './entity-select.css';

type Entity = {
  id: string;
  name?: string;
  displayName?: string;
  contactName?: string;
  companyName?: string;
  sku?: string;
  customerNo?: string;
  orderNo?: string;
  customerName?: string;
  [key: string]: unknown;
};
type Resource =
  | 'products'
  | 'customers'
  | 'orders'
  | 'assets'
  | 'users'
  | 'merchant-accounts'
  | 'dictionaries';
interface EntityPage {
  items: Entity[];
  total: number;
  page: number;
  pageSize: number;
}
interface EntitySelectProps {
  resource: Resource;
  label: string;
  value: string | string[];
  onChange: (value: any) => void;
  onSelect?: (entity: any) => void;
  selectedOptions?: Entity[];
  multiple?: boolean;
  disabled?: boolean;
  required?: boolean;
  filters?: Record<string, string>;
}

const entityName = (item: Entity) =>
  item.orderNo ||
  item.name ||
  item.displayName ||
  item.contactName ||
  item.customerName ||
  item.companyName ||
  item.id;

export function EntitySelect({
  resource,
  label,
  value,
  onChange,
  onSelect,
  selectedOptions = [],
  multiple = false,
  disabled,
  required,
  filters = {},
}: EntitySelectProps) {
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const [remembered, setRemembered] = useState<Entity[]>([]);
  const query = useDebounce(search);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const list = useInfiniteQuery({
    queryKey: ['entity-options', resource, filters, query],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api<EntityPage>(
        `/${resource}?${queryString({ ...filters, q: query, page: pageParam, pageSize: 50 })}`,
        { signal },
      ),
    getNextPageParam: (page) =>
      page.page * page.pageSize < page.total ? page.page + 1 : undefined,
    enabled: open,
    staleTime: 15000,
  });
  const options = useMemo(() => list.data?.pages.flatMap((page) => page.items) || [], [list.data]);
  const known = useMemo(
    () => new Map([...selectedOptions, ...remembered, ...options].map((item) => [item.id, item])),
    [selectedOptions, remembered, options],
  );
  const detailResources = ['products', 'customers', 'assets', 'orders'];
  const missing = selected.filter((id) => !known.has(id) && detailResources.includes(resource));
  const details = useQueries({
    queries: missing.map((id) => ({
      queryKey: ['entity-option', resource, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Entity>(`/${resource}/${id}`, { signal }),
      staleTime: 60000,
    })),
  });
  for (const detail of details) if (detail.data) known.set(detail.data.id, detail.data);
  const names = selected.map((id) => (known.has(id) ? entityName(known.get(id)!) : '已选择'));
  const text =
    names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 项` : names.join('、');

  function choose(item: Entity) {
    setInvalid(false);
    setRemembered((current) => [...current.filter((option) => option.id !== item.id), item]);
    if (multiple)
      onChange(
        selected.includes(item.id)
          ? selected.filter((id) => id !== item.id)
          : [...selected, item.id],
      );
    else {
      onChange(item.id);
      setOpen(false);
    }
    onSelect?.(item);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="entity-select-field">
        {required && (
          <input
            className="entity-validation"
            value={selected.join(',')}
            required
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            onChange={() => {}}
            onInvalid={(event) => {
              event.preventDefault();
              setInvalid(true);
              trigger.current?.focus();
              setOpen(true);
            }}
          />
        )}
        <Popover.Trigger asChild>
          <button
            type="button"
            ref={trigger}
            className="input entity-select-trigger"
            aria-label={label}
            aria-invalid={invalid || undefined}
            disabled={disabled}
          >
            <span className={cn(!text && 'entity-placeholder')}>{text || `选择${label}`}</span>
            <ChevronsUpDown size={14} />
          </button>
        </Popover.Trigger>
        {!required && selected.length > 0 && !disabled && (
          <button
            type="button"
            className="entity-clear"
            aria-label={`清空${label}`}
            onClick={() => onChange(multiple ? [] : '')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          className="popover-content entity-select-popover"
          align="start"
          sideOffset={5}
        >
          <SearchInput label={`搜索${label}`} value={search} onChange={setSearch} />
          <ErrorMessage error={list.error} retry={() => void list.refetch()} />
          <div
            className="entity-select-options"
            role="listbox"
            aria-label={`${label}选项`}
            aria-multiselectable={multiple}
          >
            {list.isPending ? (
              <div className="entity-select-pending" role="status">
                <LoaderCircle className="spin" size={18} />
              </div>
            ) : options.length === 0 ? (
              <div className="entity-select-pending">暂无匹配记录</div>
            ) : (
              options.map((item) => (
                <button
                  type="button"
                  className="entity-option"
                  role="option"
                  aria-selected={selected.includes(item.id)}
                  key={item.id}
                  onClick={() => choose(item)}
                >
                  <span className={cn('check-box', selected.includes(item.id) && 'checked')}>
                    {selected.includes(item.id) && <Check size={12} />}
                  </span>
                  <span>
                    <strong>{entityName(item)}</strong>
                    {(item.sku || item.customerNo || (item.companyName && item.contactName)) && (
                      <small>
                        {[item.sku || item.customerNo, item.companyName]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    )}
                  </span>
                </button>
              ))
            )}
            {list.hasNextPage && (
              <Button
                className="entity-load-more"
                size="sm"
                pending={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                加载更多
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
