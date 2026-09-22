import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

interface CustomerDraft<T> {
  document: Partial<T> | null;
  version: number;
  updatedAt: string | null;
}

export function useCustomerDraft<T extends object>(blank: T, enabled: boolean) {
  const [document, setDocument] = useState<T>({ ...blank });
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [savedDocument, setSavedDocument] = useState(JSON.stringify(blank));
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const current = useRef({ ...blank });
  const saved = useRef(JSON.stringify(blank));
  const version = useRef(0);
  const pending = useRef<Promise<number> | null>(null);
  const failure = useRef<unknown>(null);
  const initialized = useRef(false);
  const active = useRef(false);
  const frozen = useRef(false);
  const completed = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const recordFailure = useCallback((value: unknown) => {
    failure.current = value;
    if (active.current) setError(value);
  }, []);

  const load = useCallback(async () => {
    if (!active.current || pending.current || frozen.current) return;
    const signal = controller.current?.signal;
    setLoading(true);
    recordFailure(null);
    try {
      const result = await api<CustomerDraft<T>>('/customer-drafts/current', {
        signal,
      });
      if (!active.current || signal?.aborted) return;
      const value = { ...blank, ...result.document };
      current.current = value;
      saved.current = JSON.stringify(value);
      version.current = result.version;
      initialized.current = true;
      setDocument(value);
      setSavedDocument(saved.current);
      setHasSavedDraft(result.document !== null);
      setReady(true);
      recordFailure(null);
    } catch (value) {
      if (active.current && !signal?.aborted) recordFailure(value);
    } finally {
      if (active.current && !signal?.aborted) setLoading(false);
    }
  }, [blank, recordFailure]);

  useEffect(() => {
    if (!enabled) return;
    active.current = true;
    controller.current = new AbortController();
    void load();
    const stop = () => {
      active.current = false;
      controller.current?.abort();
    };
    window.addEventListener('session-reset', stop);
    return () => {
      stop();
      window.removeEventListener('session-reset', stop);
    };
  }, [enabled, load]);

  const flush = useCallback((): Promise<number> => {
    if (pending.current) return pending.current;
    if (!active.current || !initialized.current || completed.current)
      return Promise.reject(new Error('草稿尚未载入'));
    if (failure.current instanceof ApiError && failure.current.status === 409)
      return Promise.reject(failure.current);
    if (JSON.stringify(current.current) === saved.current) return Promise.resolve(version.current);
    setSaving(true);
    recordFailure(null);
    const operation = async () => {
      try {
        while (active.current && JSON.stringify(current.current) !== saved.current) {
          const value = current.current;
          const result = await api<CustomerDraft<T>>('/customer-drafts/current', {
            method: 'PUT',
            body: JSON.stringify({ version: version.current, document: value }),
            signal: controller.current?.signal,
          });
          if (!active.current) throw new Error('登录已失效');
          version.current = result.version;
          saved.current = JSON.stringify(value);
          setSavedDocument(saved.current);
          setHasSavedDraft(true);
        }
        return version.current;
      } catch (value) {
        if (active.current) recordFailure(value);
        throw value;
      } finally {
        pending.current = null;
        if (active.current) setSaving(false);
      }
    };
    pending.current = operation();
    return pending.current;
  }, [recordFailure]);

  const dirty = JSON.stringify(document) !== savedDocument;
  useEffect(() => {
    if (!enabled || !ready || !dirty || locked || error || completed.current) return;
    const timer = window.setTimeout(() => {
      if (!frozen.current && !completed.current) void flush().catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [document, dirty, enabled, error, flush, locked, ready]);

  function update<K extends keyof T>(key: K, value: T[K]) {
    if (!initialized.current || frozen.current || completed.current) return;
    const next = { ...current.current, [key]: value };
    current.current = next;
    setDocument(next);
    if (!(failure.current instanceof ApiError && failure.current.status === 409))
      recordFailure(null);
  }

  function lock(value: boolean) {
    frozen.current = value;
    if (active.current) setLocked(value);
  }

  async function clear() {
    if (frozen.current || !initialized.current) return;
    lock(true);
    try {
      if (pending.current) await pending.current;
      const result = await api<CustomerDraft<T>>('/customer-drafts/current', {
        method: 'DELETE',
        body: JSON.stringify({ version: version.current }),
        signal: controller.current?.signal,
      });
      if (!active.current) return;
      current.current = { ...blank };
      saved.current = JSON.stringify(blank);
      version.current = result.version;
      setDocument(current.current);
      setSavedDocument(saved.current);
      setHasSavedDraft(false);
      recordFailure(null);
    } catch (value) {
      if (active.current) recordFailure(value);
    } finally {
      lock(false);
    }
  }

  async function saveCurrent() {
    if (frozen.current || !initialized.current) return;
    lock(true);
    try {
      if (pending.current) await pending.current;
      const result = await api<CustomerDraft<T>>('/customer-drafts/current', {
        signal: controller.current?.signal,
      });
      if (!active.current) return;
      version.current = result.version;
      saved.current = JSON.stringify({ ...blank, ...result.document });
      setSavedDocument(saved.current);
      recordFailure(null);
      await flush();
    } catch (value) {
      if (active.current) recordFailure(value);
    } finally {
      lock(false);
    }
  }

  return {
    document,
    loading,
    ready,
    saving,
    locked,
    error,
    dirty,
    hasSavedDraft,
    conflict: error instanceof ApiError && error.status === 409,
    update,
    flush,
    load,
    clear,
    saveCurrent,
    reject: recordFailure,
    async prepare() {
      if (frozen.current) throw new Error('正在保存');
      lock(true);
      try {
        return await flush();
      } catch (value) {
        lock(false);
        throw value;
      }
    },
    release() {
      lock(false);
    },
    consume() {
      completed.current = true;
      saved.current = JSON.stringify(current.current);
      setSavedDocument(saved.current);
    },
  };
}
