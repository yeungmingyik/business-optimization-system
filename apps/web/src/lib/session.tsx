import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, LockKeyhole, LogIn } from 'lucide-react';
import { api, post, queryClient, setCsrfToken } from './api';
import type { Session, User } from './types';
import { Button, ErrorMessage, Field, Input, Loading, Modal } from '../components/ui';

interface SessionContextValue {
  user: User;
  logout: () => Promise<void>;
  changePassword: () => void;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('登录已失效');
  return context;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Session>('/auth/me'),
    staleTime: 60_000,
  });
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const invalidate = () => {
      setCsrfToken('');
      window.dispatchEvent(new Event('session-reset'));
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      setExpired(true);
      queryClient.setQueryData(['session'], null);
    };
    window.addEventListener('session-expired', invalidate);
    return () => window.removeEventListener('session-expired', invalidate);
  }, []);
  useEffect(() => {
    if (session.data?.csrfToken) setCsrfToken(session.data.csrfToken);
  }, [session.data]);
  async function logout() {
    try {
      await post('/auth/logout');
    } finally {
      setCsrfToken('');
      window.dispatchEvent(new Event('session-reset'));
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      queryClient.setQueryData(['session'], null);
    }
  }
  if (session.isPending)
    return (
      <div className="boot-loading">
        <img src="/logo.jpg" alt="YIJINTOOL" />
        <Loading rows={2} />
      </div>
    );
  if (!session.data)
    return (
      <Login
        expired={expired}
        onSuccess={(value) => {
          setExpired(false);
          setCsrfToken(value.csrfToken);
          window.dispatchEvent(new Event('session-reset'));
          queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
          queryClient.setQueryData(['session'], value);
        }}
      />
    );
  return (
    <SessionContext.Provider
      value={{ user: session.data.user, logout, changePassword: () => setPasswordOpen(true) }}
    >
      {session.data.user.mustChangePassword ? (
        <div className="password-required">
          <div className="brand">
            <img src="/logo.jpg" alt="" />
            <strong>YIJINTOOL</strong>
          </div>
        </div>
      ) : (
        children
      )}
      <PasswordModal
        open={passwordOpen || session.data.user.mustChangePassword}
        forced={session.data.user.mustChangePassword}
        onOpenChange={setPasswordOpen}
        onSuccess={async () => {
          setPasswordOpen(false);
          setCsrfToken('');
          window.dispatchEvent(new Event('session-reset'));
          queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
          queryClient.setQueryData(['session'], null);
        }}
      />
    </SessionContext.Provider>
  );
}

function Login({
  expired,
  onSuccess,
}: {
  expired: boolean;
  onSuccess: (session: Session) => void;
}) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const login = useMutation({
    mutationFn: () => post<Session>('/auth/login', { loginName, password }),
    onSuccess,
  });
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.jpg" alt="YIJINTOOL" />
          <strong>YIJINTOOL</strong>
        </div>
        <h1>经营管理</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            login.mutate();
          }}
        >
          <Field label="账号" required>
            <Input
              autoFocus
              autoComplete="username"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              required
              maxLength={100}
            />
          </Field>
          <Field label="密码" required>
            <span className="password-input">
              <Input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? '隐藏密码' : '显示密码'}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </Field>
          {expired && !login.error && <ErrorMessage error="登录已失效" />}
          <ErrorMessage error={login.error} />
          <Button
            variant="primary"
            type="submit"
            pending={login.isPending}
            className="login-submit"
          >
            <LogIn size={17} />
            登录
          </Button>
        </form>
      </div>
    </main>
  );
}

function PasswordModal({
  open,
  forced,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  forced: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [validation, setValidation] = useState('');
  const mutation = useMutation({
    mutationFn: () => post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess,
  });
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!forced) onOpenChange(value);
      }}
      title="修改密码"
      footer={
        <>
          <Button
            onClick={async () => {
              if (forced) {
                await post('/auth/logout');
                onSuccess();
              } else onOpenChange(false);
            }}
          >
            {forced ? '退出' : '取消'}
          </Button>
          <Button variant="primary" type="submit" form="password-form" pending={mutation.isPending}>
            <LockKeyhole size={15} />
            保存密码
          </Button>
        </>
      }
    >
      <form
        id="password-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (newPassword !== repeat) {
            setValidation('两次输入的密码不一致');
            return;
          }
          setValidation('');
          mutation.mutate();
        }}
      >
        <Field label="当前密码" required>
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="新密码" required>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label="确认新密码" required>
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </Field>
        <ErrorMessage error={validation || mutation.error} />
      </form>
    </Modal>
  );
}
