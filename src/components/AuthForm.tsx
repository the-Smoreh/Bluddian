'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ApiError, post } from '@/lib/client';

/**
 * Login and first-run setup share a form because they share every field but
 * one. Splitting them would duplicate the password-strength UI and the 2FA
 * step handling for no benefit.
 */
export function AuthForm({
  mode,
  requiresSetupCode,
}: {
  mode: 'login' | 'setup';
  requiresSetupCode: boolean;
}) {
  const isSetup = mode === 'setup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [code, setCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const strength = passwordStrength(password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      if (isSetup) {
        await post('/api/auth/setup', {
          email,
          password,
          displayName: displayName || 'Founder',
          ...(requiresSetupCode ? { setupCode } : {}),
        });
      } else {
        const res = await post<{ needsTotp?: boolean }>('/api/auth/login', {
          email,
          password,
          ...(needsTotp ? { code } : {}),
        });

        // The server asks for a second factor without creating a session.
        if (res?.needsTotp) {
          setNeedsTotp(true);
          setBusy(false);
          return;
        }
      }

      // Full reload so server components re-render with the new session.
      window.location.href = new URLSearchParams(window.location.search).get('next') || '/';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl
                        bg-gradient-to-br from-brand to-brand2 shadow-xl shadow-brand/30">
          <Icon name="trophy" size={30} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Bluddian</h1>
        <p className="mt-1.5 text-sm text-muted">
          {isSetup ? 'Claim your dashboard. This runs once.' : 'Sign in to your dashboard.'}
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        {isSetup ? (
          <div>
            <label className="label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Founder"
              autoComplete="name"
              maxLength={60}
            />
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete={isSetup ? 'email' : 'username'}
            inputMode="email"
            disabled={needsTotp}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSetup ? 'At least 12 characters' : '••••••••••••'}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            disabled={needsTotp}
          />
          {isSetup && password ? (
            <div className="mt-2">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{
                      background:
                        i < strength.score ? strength.color : 'rgb(var(--viz-track))',
                    }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{strength.label}</p>
            </div>
          ) : null}
        </div>

        {isSetup && requiresSetupCode ? (
          <div>
            <label className="label" htmlFor="setupCode">
              Setup code
            </label>
            <input
              id="setupCode"
              className="input"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              placeholder="From your SETUP_CODE env var"
              autoComplete="off"
            />
          </div>
        ) : null}

        {needsTotp ? (
          <div className="animate-pop-in">
            <label className="label" htmlFor="code">
              Authenticator code
            </label>
            <input
              id="code"
              className="input text-center text-2xl tracking-[0.4em] nums"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </div>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2.5 text-sm text-bad">
            <Icon name="x" size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Working…' : needsTotp ? 'Verify' : isSetup ? 'Create dashboard' : 'Sign in'}
        </button>
      </form>

      {isSetup ? (
        <p className="mt-5 flex items-start gap-2 px-1 text-xs leading-relaxed text-faint">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
          <span>
            Only one account can ever be created here. Your password is hashed with scrypt and API
            keys you add later are encrypted at rest.
          </span>
        </p>
      ) : null}
    </main>
  );
}

/** Length-dominant scoring — length beats character-class theatre. */
function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: '' };

  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (pw.length >= 20) score++;
  if (/[^a-zA-Z0-9]/.test(pw) && /\d/.test(pw)) score++;

  const levels = [
    { label: 'Too short — 12 character minimum.', color: 'rgb(var(--c-bad))' },
    { label: 'Weak. Longer is better than fancier.', color: 'rgb(var(--c-bad))' },
    { label: 'Decent.', color: 'rgb(var(--c-warn))' },
    { label: 'Strong.', color: 'rgb(var(--c-good))' },
    { label: 'Excellent.', color: 'rgb(var(--c-good))' },
  ];

  return { score, ...levels[Math.min(score, 4)] };
}
