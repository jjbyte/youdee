'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, isApiError } from '@/lib/api';
import type { QuoteListItem } from '@/lib/types';
import { formatMoney, formatTimeRel } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/field';
import { IconError } from '@/components/icons';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<QuoteListItem[] | null>(null);

  // 左侧不是营销区，是"上次你在哪"的记忆区。拿不到就退化成一句话，不报错。
  useEffect(() => {
    let alive = true;
    api
      .quotes({ limit: 3 })
      .then((page) => alive && setRecent(page.items ?? []))
      .catch(() => alive && setRecent(null));
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.login(login.trim(), password);
      router.replace('/');
    } catch (err) {
      setError(
        isApiError(err) && err.status === 429
          ? err.message
          : errorMessage(err),
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <section className="login__left">
        <div>
          <div className="login__brand">有底</div>
          <div className="login__tagline">物料 · 人员 · 供应商 · 报价</div>
        </div>

        <div className="login__recent">
          <div className="login__recent-title">最近一次登录</div>
          {recent && recent.length > 0 ? (
            recent.map((q) => (
              <div className="login__recent-item" key={q.id}>
                <span className="login__recent-date">{formatTimeRel(q.issuedAt ?? q.createdAt)}</span>
                <span className="truncate">
                  {q.eventName} · {q.customerName}
                </span>
                <span style={{ flex: 1 }} />
                <span className="login__recent-date">{q.quoteNo}</span>
                <span className="login__recent-date">{formatMoney(q.totalPrice, { symbol: true })}</span>
              </div>
            ))
          ) : (
            <div className="t-sm" style={{ color: 'var(--sidebar-fg-muted)' }}>
              登录后自动回到你上次停留的位置。
            </div>
          )}
        </div>

        <div className="login__version">v1.0.0</div>
      </section>

      <section className="login__right">
        <form className="login__form" onSubmit={submit} noValidate>
          <div>
            <h1 className="t-xl" style={{ margin: 0 }}>
              登录
            </h1>
          </div>

          <Field label="账号" htmlFor="login">
            <Input
              id="login"
              className="login__input"
              autoComplete="username"
              autoFocus
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="wanglei@huodong.cn"
              aria-invalid={error ? true : undefined}
            />
          </Field>

          <Field label="密码" htmlFor="password">
            <PasswordInput
              id="password"
              className="login__input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              visible={showPassword}
              onToggleVisible={() => setShowPassword((v) => !v)}
              aria-invalid={error ? true : undefined}
            />
          </Field>

          {error ? (
            <div className="field-error" role="alert">
              <IconError size={16} />
              <span>{error}</span>
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="lg" loading={submitting} block>
            登 录
          </Button>

          <div className="hint">忘记密码找管理员重置。</div>
        </form>
      </section>
    </div>
  );
}
