import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, Check, Pencil, Plus, RotateCcw } from 'lucide-react';
import { api, patch, post, queryClient, queryString } from '../lib/api';
import { useSession } from '../lib/session';
import { CHANNELS, type Option, type Page } from '../lib/types';
import { Button, ErrorMessage, Field, Input, Select, Sheet } from './ui';

export function DictionaryManager({
  open,
  onOpenChange,
  kind,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: string;
  title: string;
}) {
  const { user } = useSession();
  const merchant = kind === 'merchant-accounts';
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('企业微信');
  const [edit, setEdit] = useState<Option | null>(null);
  const [archived, setArchived] = useState(false);
  const base = merchant ? '/merchant-accounts' : '/dictionaries';
  const query = useQuery({
    queryKey: [kind, 'manage', archived],
    queryFn: () =>
      api<Page<Option>>(
        `${base}?${queryString({ kind: merchant ? '' : kind, includeArchived: merchant ? true : undefined, archived: archived || undefined, pageSize: 100 })}`,
      ),
    enabled: open,
  });
  const mutate = useMutation({
    mutationFn: async ({ action, item }: { action: string; item?: Option }) => {
      if (action === 'save')
        return edit
          ? patch(`${base}/${edit.id}`, {
              version: edit.version,
              name,
              ...(merchant ? { platform, enabled: edit.enabled } : {}),
            })
          : post(base, { name, ...(merchant ? { platform } : { kind }) });
      if (merchant && item)
        return patch(`${base}/${item.id}`, {
          version: item.version,
          name: item.name,
          platform: item.platform,
          enabled: !item.enabled,
        });
      return post(`${base}/${item!.id}/${item!.archivedAt ? 'restore' : 'archive'}`, {
        version: item!.version,
      });
    },
    onSuccess: () => {
      setEdit(null);
      setName('');
      void queryClient.invalidateQueries({ queryKey: [kind] });
      void queryClient.invalidateQueries({ queryKey: ['dictionaries'] });
      void queryClient.invalidateQueries({ queryKey: ['merchant-accounts'] });
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="dictionary-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutate.mutate({ action: 'save' });
        }}
      >
        <Field label="名称" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
          />
        </Field>
        {merchant && (
          <Field label="平台" required>
            <Select value={platform} onChange={(event) => setPlatform(event.target.value)}>
              {CHANNELS.map((channel) => (
                <option key={channel}>{channel}</option>
              ))}
            </Select>
          </Field>
        )}
        <Button variant="primary" type="submit" pending={mutate.isPending}>
          {edit ? <Check size={15} /> : <Plus size={15} />}
          {edit ? '保存' : '新增'}
        </Button>
        {edit && (
          <Button
            onClick={() => {
              setEdit(null);
              setName('');
            }}
          >
            取消
          </Button>
        )}
      </form>
      <ErrorMessage error={mutate.error || query.error} />
      {user.role === 'BOSS' && !merchant && (
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          已归档
        </label>
      )}
      <div className="dictionary-list">
        {query.data?.items.map((item) => (
          <div className="dictionary-row" key={item.id}>
            <span>
              <strong>{item.name}</strong>
              {merchant && (
                <small>
                  {item.platform} · {item.enabled ? '启用' : '停用'}
                </small>
              )}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`编辑${item.name}`}
              onClick={() => {
                setEdit(item);
                setName(item.name);
                setPlatform(item.platform || '企业微信');
              }}
            >
              <Pencil size={15} />
            </Button>
            {user.role === 'BOSS' && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={item.archivedAt || (merchant && !item.enabled) ? '恢复' : '归档'}
                pending={mutate.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `确认${merchant ? (item.enabled ? '停用' : '启用') : item.archivedAt ? '恢复' : '归档'}“${item.name}”？`,
                    )
                  )
                    mutate.mutate({ action: 'archive', item });
                }}
              >
                {item.archivedAt || (merchant && !item.enabled) ? (
                  <RotateCcw size={15} />
                ) : (
                  <Archive size={15} />
                )}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
