import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useEffect, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';

const amountFormatter = new Intl.NumberFormat('zh-CN');
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const inputDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export function money(value: string | number | undefined | null) {
  const text = String(value || '0');
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return '0.00';
  const [whole, fractional = ''] = text.split('.');
  return `${amountFormatter.format(BigInt(whole))}.${fractional.padEnd(2, '0')}`;
}
export function date(value?: string | null, time = false) {
  if (!value) return '—';
  return (time ? dateTimeFormatter : dateFormatter).format(new Date(value));
}
export function today(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return inputDateFormatter.format(value);
}
export function localDateTime(value?: string | null) {
  const input = value ? new Date(value) : new Date();
  return new Date(input.getTime() - input.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function iso(value?: string | null) {
  return value ? new Date(value).toISOString() : null;
}
export function size(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
export function cents(value: string | number): bigint {
  const text = String(value);
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(text)) return 0n;
  const [whole, fractional = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fractional.padEnd(2, '0'));
}
export function decimal(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
export function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export function useDirtyGuard(dirty: boolean) {
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm('有未保存的修改，确认离开？'),
    enableBeforeUnload: dirty,
  });
}
