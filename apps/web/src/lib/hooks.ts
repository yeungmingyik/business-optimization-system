import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { api, queryString } from './api';
import { useDebounce } from './utils';
import type { Option, Page, Product, User } from './types';
import { useSession } from './session';

const rememberedLists = new Map<string, { filters: Record<string, string>; search: string }>();
window.addEventListener('session-reset', () => rememberedLists.clear());

export function useListState(defaults: Record<string, string> = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const remembered = rememberedLists.get(location.pathname);
  const routeFilters = Object.fromEntries(
    Object.entries(location.search)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
  const [search, setSearch] = useState(remembered?.search || '');
  const q = useDebounce(search);
  const filters = {
    ...defaults,
    ...(Object.keys(routeFilters).length ? routeFilters : remembered?.filters || {}),
  };
  const filterRef = useRef(filters);
  filterRef.current = filters;
  const previousQuery = useRef(q);
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || 50);
  function setFilters(values: Record<string, string>) {
    const next = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''));
    filterRef.current = next;
    rememberedLists.set(location.pathname, { filters: next, search });
    void navigate({ to: location.pathname, search: next, replace: true, resetScroll: false });
  }
  useEffect(() => {
    rememberedLists.set(location.pathname, { filters: filterRef.current, search });
  }, [location.pathname, search, location.search]);
  useEffect(() => {
    if (!Object.keys(routeFilters).length && Object.keys(filters).length) {
      void navigate({ to: location.pathname, search: filters, replace: true, resetScroll: false });
    }
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (previousQuery.current !== q) {
      previousQuery.current = q;
      setFilters({ ...filterRef.current, page: '1' });
    }
  }, [q]);
  function filter(key: string, value: string) {
    setFilters({ ...filterRef.current, [key]: value, page: '1' });
  }
  return {
    search,
    setSearch,
    q,
    filters,
    filter,
    page,
    pageSize,
    params: { ...filters, q, page, pageSize },
    setPage: (value: number) => setFilters({ ...filterRef.current, page: String(value) }),
    setPageSize: (value: number) =>
      setFilters({ ...filterRef.current, pageSize: String(value), page: '1' }),
    reset: () => {
      setSearch('');
      setFilters(defaults);
    },
  };
}
export function useOptions(kind: string, enabled = true) {
  return useQuery({
    queryKey: ['dictionaries', kind],
    queryFn: ({ signal }) =>
      api<Page<Option>>(`/dictionaries?${queryString({ kind, pageSize: 100 })}`, { signal }),
    enabled,
  });
}
export function useProducts() {
  return useQuery({
    queryKey: ['product-options'],
    queryFn: ({ signal }) => api<Page<Product>>('/products?pageSize=100', { signal }),
  });
}
export function useMerchants() {
  return useQuery({
    queryKey: ['merchant-accounts'],
    queryFn: ({ signal }) => api<Page<Option>>('/merchant-accounts?pageSize=100', { signal }),
  });
}
export function useUsers() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['user-options'],
    queryFn: ({ signal }) => api<Page<User>>('/users?pageSize=100', { signal }),
    enabled: user.role === 'BOSS',
  });
}
