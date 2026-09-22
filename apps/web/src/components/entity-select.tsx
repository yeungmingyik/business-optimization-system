import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
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

const entityTitle = (item?: Entity) =>
  item?.orderNo ||
  item?.name ||
  item?.displayName ||
  item?.contactName ||
  item?.customerName ||
  item?.companyName;
const entityName = (item: Entity) => entityTitle(item) || item.id;
const detailResources = new Set<Resource>(['products', 'customers', 'assets', 'orders']);
const emptyOptions: Entity[] = [];
const emptyFilters: Record<string, string> = {};

function combineDetails(results: Array<{ data?: Entity }>) {
  return results.flatMap((result) => (result.data ? [result.data] : []));
}

function EntityDetails({
  resource,
  ids,
  onResolved,
}: {
  resource: Resource;
  ids: string[];
  onResolved: (items: Entity[]) => void;
}) {
  const entities = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['entity-option', resource, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Entity>(`/${resource}/${id}`, { signal }),
      staleTime: 60000,
    })),
    combine: combineDetails,
  });
  useEffect(() => onResolved(entities), [entities, onResolved]);
  return null;
}

function EntityOptions({
  resource,
  label,
  filters,
  search,
  onSearchChange,
  selected,
  multiple,
  onChoose,
  onResolved,
}: {
  resource: Resource;
  label: string;
  filters: Record<string, string>;
  search: string;
  onSearchChange: (value: string) => void;
  selected: string[];
  multiple: boolean;
  onChoose: (item: Entity) => void;
  onResolved: (items: Entity[]) => void;
}) {
  const query = useDebounce(search);
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
    staleTime: 15000,
    refetchOnMount: 'always',
  });
  const options = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) || emptyOptions,
    [list.data],
  );
  const resolved = useMemo(
    () => options.filter((item) => selected.includes(item.id)),
    [options, selected],
  );
  useEffect(() => onResolved(resolved), [resolved, onResolved]);
  return (
    <>
      <SearchInput label={`搜索${label}`} value={search} onChange={onSearchChange} />
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
              onClick={() => onChoose(item)}
            >
              <span className={cn('check-box', selected.includes(item.id) && 'checked')}>
                {selected.includes(item.id) && <Check size={12} />}
              </span>
              <span>
                <strong>{entityName(item)}</strong>
                {(item.sku || item.customerNo || (item.companyName && item.contactName)) && (
                  <small>
                    {[item.sku || item.customerNo, item.companyName].filter(Boolean).join(' · ')}
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
    </>
  );
}

function EntityPopover({
  trigger,
  contentId,
  label,
  onOpenChange,
  children,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  contentId: string;
  label: string;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const restoreFocus = useRef(true);
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => trigger.current?.getBoundingClientRect() ?? new DOMRect(),
        get contextElement() {
          return trigger.current ?? undefined;
        },
      },
    }),
    [trigger],
  );
  return (
    <Popover.Root open onOpenChange={onOpenChange}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          id={contentId}
          aria-label={label}
          className="popover-content entity-select-popover"
          align="start"
          sideOffset={5}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && trigger.current?.contains(event.target)) {
              event.preventDefault();
              return;
            }
            restoreFocus.current = false;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocus.current && trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function EntitySelect({
  resource,
  label,
  value,
  onChange,
  onSelect,
  selectedOptions = emptyOptions,
  multiple = false,
  disabled,
  required,
  filters = emptyFilters,
}: EntitySelectProps) {
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const contentId = useId();
  const [search, setSearch] = useState('');
  const [remembered, setRemembered] = useState<Record<string, Entity>>({});
  const selected = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);
  const known = useMemo(() => {
    const entities = new Map(selectedOptions.map((item) => [item.id, item]));
    for (const id of selected) {
      const entity = remembered[`${resource}:${id}`];
      if (entity) entities.set(id, entity);
    }
    return entities;
  }, [selectedOptions, remembered, resource, selected]);
  const missing = selected.filter(
    (id) =>
      detailResources.has(resource) &&
      !entityTitle(known.get(id)) &&
      !remembered[`${resource}:${id}`],
  );
  const rememberEntities = useCallback(
    (items: Entity[]) => {
      if (!items.length) return;
      setRemembered((current) => {
        let next = current;
        for (const item of items) {
          const key = `${resource}:${item.id}`;
          if (current[key] === item) continue;
          if (next === current) next = { ...current };
          next[key] = item;
        }
        return next;
      });
    },
    [resource],
  );
  const names = selected.map((id) => (known.has(id) ? entityName(known.get(id)!) : '已选择'));
  const text =
    names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 项` : names.join('、');

  function choose(item: Entity) {
    setInvalid(false);
    rememberEntities([item]);
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
    <>
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
        <button
          type="button"
          ref={trigger}
          className="input entity-select-trigger"
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={contentId}
          data-state={open ? 'open' : 'closed'}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span className={cn(!text && 'entity-placeholder')}>{text || `选择${label}`}</span>
          <ChevronsUpDown size={14} />
        </button>
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
      {missing.length > 0 && (
        <EntityDetails resource={resource} ids={missing} onResolved={rememberEntities} />
      )}
      {open && (
        <EntityPopover trigger={trigger} contentId={contentId} label={label} onOpenChange={setOpen}>
          <EntityOptions
            resource={resource}
            label={label}
            filters={filters}
            search={search}
            onSearchChange={setSearch}
            selected={selected}
            multiple={multiple}
            onChoose={choose}
            onResolved={rememberEntities}
          />
        </EntityPopover>
      )}
    </>
  );
}
