import { useEffect, useId, useRef, useState } from 'react';
import { ScanText, Upload, X } from 'lucide-react';
import { api, ApiError, fileUrl, upload } from '../lib/api';
import { recognizeWaybill, type WaybillRecognition } from '../lib/waybill-recognition';
import { Button, ErrorMessage, Field, Input } from './ui';

type Attachment = { id: string; name: string; mediaType: string; bytes: number; pending: boolean };

export function WaybillAttachments({
  value,
  onChange,
  disabled,
  onRecognized,
  onBusyChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  onRecognized?: (value: WaybillRecognition) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Record<string, Attachment>>({});
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<'upload' | 'recognize' | 'remove' | null>(null);
  const [progress, setProgress] = useState(0);
  const [recognition, setRecognition] = useState<WaybillRecognition | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const currentValue = useRef(value);
  const change = useRef(onChange);
  const busyChange = useRef(onBusyChange);
  const currentAttachments = useRef(attachments);
  currentValue.current = value;
  change.current = onChange;
  busyChange.current = onBusyChange;
  currentAttachments.current = attachments;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      busyChange.current?.(false);
      for (const id of currentValue.current) {
        if (currentAttachments.current[id]?.pending)
          void api(`/waybills/${id}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    busyChange.current?.(!!busy);
  }, [busy]);

  const ids = value.join(',');
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(
      ids
        .split(',')
        .filter(Boolean)
        .map((id) => api<Attachment>(`/waybills/${id}`, { signal: abort.signal })),
    )
      .then((items) => {
        if (!abort.signal.aborted)
          setAttachments(Object.fromEntries(items.map((item) => [item.id, item])));
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure);
      });
    return () => abort.abort();
  }, [ids]);

  async function add(file: File) {
    if (busy || disabled) return;
    setError(undefined);
    if (value.length >= 5) {
      setError(new Error('每条物流最多上传5张运单图片'));
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(new Error('仅支持 JPG、PNG、WebP 图片'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(new Error('运单图片不能超过10MB'));
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy('upload');
    setProgress(0);
    busyChange.current?.(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const attachment = await upload<Attachment>('/waybills', body, setProgress, abort.signal);
      if (!mounted.current || abort.signal.aborted) {
        await api(`/waybills/${attachment.id}`, { method: 'DELETE' }).catch(() => undefined);
        return;
      }
      setAttachments((previous) => ({ ...previous, [attachment.id]: attachment }));
      change.current([...currentValue.current, attachment.id]);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) setError(failure);
    } finally {
      if (mounted.current) {
        setBusy(null);
        busyChange.current?.(false);
      }
      controller.current = null;
    }
  }

  async function recognize(id: string) {
    if (controller.current || busy || disabled) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(undefined);
    setRecognition(null);
    setBusy('recognize');
    busyChange.current?.(true);
    try {
      const result = await recognizeWaybill(id, abort.signal);
      if (
        mounted.current &&
        controller.current === abort &&
        !abort.signal.aborted &&
        currentValue.current.includes(id)
      ) {
        if (!result.carrier && !result.trackingNo)
          setError(new Error('未识别到物流信息，请手动填写'));
        else setRecognition(result);
      }
    } catch (failure) {
      if (mounted.current && controller.current === abort && !abort.signal.aborted)
        setError(failure);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (mounted.current) {
          setBusy(null);
          busyChange.current?.(false);
        }
      }
    }
  }

  async function remove(id: string) {
    if (busy || disabled) return;
    setError(undefined);
    setBusy('remove');
    busyChange.current?.(true);
    try {
      if (attachments[id]?.pending) {
        await api(`/waybills/${id}`, { method: 'DELETE' });
      }
      if (!mounted.current) return;
      setRecognition(null);
      change.current(currentValue.current.filter((item) => item !== id));
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status === 404) {
        setRecognition(null);
        change.current(currentValue.current.filter((item) => item !== id));
      } else setError(failure);
    } finally {
      if (mounted.current) {
        setBusy(null);
        busyChange.current?.(false);
      }
    }
  }

  return (
    <div className="waybill-attachments">
      <div className="waybill-heading">
        <span className="field-label">运单图片</span>
        {!disabled && (
          <>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void add(file);
              }}
            />
            <Button
              size="sm"
              disabled={!!busy || value.length >= 5}
              onClick={() => input.current?.click()}
              aria-controls={inputId}
            >
              <Upload size={14} />
              上传运单
            </Button>
          </>
        )}
      </div>
      {value.length > 0 && (
        <div className="waybill-list">
          {value.map((id, index) => (
            <div className="waybill-card" key={id}>
              <a
                href={fileUrl(`/waybills/${id}/content`)}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看运单图片${index + 1}`}
              >
                <img
                  src={fileUrl(`/waybills/${id}/content`)}
                  alt={attachments[id]?.name ?? `运单图片${index + 1}`}
                  loading="lazy"
                />
              </a>
              <div className="waybill-card-actions">
                <span className="waybill-name">
                  {attachments[id]?.name ?? `运单图片${index + 1}`}
                </span>
                {!disabled && (
                  <>
                    <Button size="sm" disabled={!!busy} onClick={() => void recognize(id)}>
                      <ScanText size={14} />
                      识别
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!!busy}
                      aria-label={`移除运单图片${index + 1}`}
                      onClick={() => void remove(id)}
                    >
                      <X size={14} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {busy && busy !== 'remove' && (
        <div className="waybill-progress" role="status">
          <span>{busy === 'upload' ? `上传中 ${progress}%` : '识别中'}</span>
          {busy === 'upload' && <progress value={progress} max={100} aria-label="上传进度" />}
          <Button size="sm" onClick={() => controller.current?.abort()}>
            取消
          </Button>
        </div>
      )}
      {recognition && !disabled && (
        <div className="waybill-recognition">
          <Field label="识别物流公司">
            <Input
              value={recognition.carrier ?? ''}
              onChange={(event) => setRecognition({ ...recognition, carrier: event.target.value })}
              maxLength={200}
            />
          </Field>
          <Field label="识别物流单号">
            <Input
              value={recognition.trackingNo ?? ''}
              onChange={(event) =>
                setRecognition({ ...recognition, trackingNo: event.target.value })
              }
              maxLength={200}
            />
          </Field>
          <Button
            size="sm"
            variant="primary"
            disabled={!recognition.carrier?.trim() && !recognition.trackingNo?.trim()}
            onClick={() => {
              onRecognized?.({
                carrier: recognition.carrier?.trim() || undefined,
                trackingNo: recognition.trackingNo?.trim() || undefined,
              });
              setRecognition(null);
            }}
          >
            使用识别结果
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRecognition(null)}>
            取消
          </Button>
        </div>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
