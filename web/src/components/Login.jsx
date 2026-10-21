import { useEffect, useState } from 'react';
import * as api from '../api.js';
import AuthShell, { Field } from './AuthShell.jsx';

// P14-02: with `inviteCode` (from an invite link) this is the invite's landing
// page: "You're invited to <server>", and either a sign-up form that joins it
// (no code needed) or, when this link can't create accounts, sign-in only.
// `onInviteGone()` forgets a code that turned out to be invalid.
export default function Login({ onAuthed, notice = '', inviteCode = '', onInviteGone }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [invite, setInvite] = useState(null); // the invite's preview (P14-02)
  const [inviteNote, setInviteNote] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [regMode, setRegMode] = useState('open'); // 'open' | 'code' | 'closed'
  const [emailRequired, setEmailRequired] = useState(false); // P12-02: the server requires a confirmed email
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthInfo().then((r) => {
      setRegMode(r.registration || 'open');
      setEmailRequired(!!r.emailRequired);
    }).catch(() => {});
  }, []);

  // The invite this page came from: what it's for, and whether it can make an account.
  useEffect(() => {
    if (!inviteCode) return;
    let live = true;
    api
      .getInvitePreview(inviteCode)
      .then((p) => {
        if (!live) return;
        setInvite(p);
        setMode(p.signUp ? 'register' : 'login');
      })
      .catch(() => {
        if (!live) return;
        setInviteNote('This invite is invalid or has expired.');
        onInviteGone?.();
      });
    return () => {
      live = false;
    };
    // onInviteGone is a fresh function each render; only the code matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  // Sign-up is offered when the site allows it, or this invite can create an account.
  const canRegister = invite ? invite.signUp || regMode === 'open' : regMode !== 'closed';
  // A sign-up code is only asked for in "Invite only" when no invite opens the way.
  const needsCode = (regMode === 'invite' || regMode === 'code') && !(invite && invite.signUp);

  const isRegister = mode === 'register';

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = isRegister
        ? await api.register(username.trim(), password, email.trim(), needsCode ? code.trim() : undefined, undefined, invite ? inviteCode : undefined)
        : await api.login(username.trim(), password);
      api.setToken(res.token);
      onAuthed(res.token);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={invite ? `You’re invited to ${invite.space}` : 'Welcome to DisGourd'}
      subtitle={
        invite
          ? `${invite.inviter ? `${invite.inviter} invited you · ` : ''}${invite.members} member${invite.members === 1 ? '' : 's'}. ${isRegister ? 'Create your account to join.' : 'Sign in to join.'}`
          : isRegister
            ? 'Create an account to get started'
            : 'Sign in to continue'
      }
      pose={invite ? 'party' : 'wave'}
    >
      <form onSubmit={submit} className="space-y-4">
          {(notice || inviteNote) && (
            // P9-03: signed out from another device (or a password change); P14-02: a dead invite.
            <div role="status" className="rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200">{notice || inviteNote}</div>
          )}
          {invite && !invite.signUp && !canRegister && (
            <p className="rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-300">
              This link can’t create new accounts here, so sign in to join. New accounts need an invite from the server’s admins.
            </p>
          )}
          <Field label="Username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="your_name"
              autoComplete="username"
            />
          </Field>

          {isRegister && (
            <Field label={emailRequired ? 'Email' : 'Email (optional, for password reset)'} hint={emailRequired ? 'You’ll get a link to confirm it' : undefined}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                autoComplete="email"
                required={emailRequired}
              />
            </Field>
          )}

          <Field label="Password" hint={isRegister ? 'At least 8 characters' : undefined}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </Field>

          {isRegister && needsCode && (
            <Field label="Registration code" hint="Ask the server owner">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input font-mono"
                placeholder="Enter the code you were given"
                // Phone keyboards mustn't capitalise or "correct" the code.
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          {error && (
            <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover active:scale-[.98] disabled:opacity-60 disabled:active:scale-100"
          >
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {!canRegister && !isRegister ? (
          <p className="mt-6 text-center text-sm text-gray-500">
            {invite ? 'Already have an account? Sign in above.' : 'This server isn’t accepting new accounts.'}
          </p>
        ) : (
          <p className="mt-6 text-center text-sm text-gray-400">
            {isRegister ? 'Already have an account?' : 'Need an account?'}{' '}
            <button
              className="font-semibold text-brand-hi hover:underline"
              onClick={() => {
                setMode(isRegister ? 'login' : 'register');
                setError('');
              }}
            >
              {isRegister ? 'Sign in' : 'Register'}
            </button>
          </p>
        )}
    </AuthShell>
  );
}
