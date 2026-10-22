import { useEffect, useState } from 'react';
import * as api from '../api.js';
import AuthShell, { Field } from './AuthShell.jsx';

// P14-02: with `inviteCode` (from an invite link) this is the invite's landing
// page: "You're invited to <server>", and either a sign-up form that joins it
// (no code needed) or, when this link can't create accounts, sign-in only.
// `onInviteGone()` forgets a code that turned out to be invalid.
// P12-03: "Forgot password?" (only when the server can send email) swaps the
// form for one field, username or email, and shows the server's answer.
export default function Login({ onAuthed, notice = '', inviteCode = '', onInviteGone }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [invite, setInvite] = useState(null); // the invite's preview (P14-02)
  const [inviteNote, setInviteNote] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [regMode, setRegMode] = useState('open'); // 'open' | 'code' | 'closed'
  const [emailRequired, setEmailRequired] = useState(false); // P12-02: the server requires a confirmed email
  const [mailOn, setMailOn] = useState(false); // P12-03: the server can send email, so "Forgot password?" works
  const [forgotLogin, setForgotLogin] = useState('');
  const [forgotSent, setForgotSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAuthInfo().then((r) => {
      setRegMode(r.registration || 'open');
      setEmailRequired(!!r.emailRequired);
      setMailOn(!!r.email);
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

  async function sendReset(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.forgotPassword(forgotLogin.trim());
      setForgotSent(r.message);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  function backToSignIn() {
    setMode('login');
    setError('');
    setForgotSent('');
  }

  const primary = 'w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover active:scale-[.98] disabled:opacity-60 disabled:active:scale-100';

  if (mode === 'forgot') {
    return (
      <AuthShell title="Forgot your password?" subtitle="We’ll email a link to the account’s confirmed address." pose="confused">
        {forgotSent ? (
          <div className="space-y-4">
            <p role="status" className="rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200">{forgotSent}</p>
            <p className="text-sm text-gray-400">No email address on the account? Ask a site admin for a reset link.</p>
            <button type="button" autoFocus onClick={backToSignIn} className={primary}>Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={sendReset} className="space-y-4">
            <Field label="Username or email">
              <input
                autoFocus
                value={forgotLogin}
                onChange={(e) => setForgotLogin(e.target.value)}
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </Field>
            {error && <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>}
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Please wait…' : 'Send reset link'}</button>
            <button type="button" onClick={backToSignIn} className="w-full rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-ink-700">
              Back to sign in
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

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
          {!isRegister && mailOn && (
            <div className="-mt-2 text-right">
              <button
                type="button"
                className="text-xs font-semibold text-brand-hi hover:underline"
                onClick={() => {
                  setMode('forgot');
                  setError('');
                  setForgotLogin(username.trim());
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

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
            className={primary}
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
