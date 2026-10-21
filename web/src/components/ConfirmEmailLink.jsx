import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import AuthShell from './AuthShell.jsx';

// What opening a confirmation link shows (P12-02), signed in or not: the
// token is posted once, then "Email confirmed" or why it didn't work.
// `signedIn` offers a new link straight away; `onDone` returns to the app.
export default function ConfirmEmailLink({ token, signedIn, onDone }) {
  const [state, setState] = useState({ step: 'working' }); // working | ok | failed
  const [resent, setResent] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return; // a token works once: never post it twice
    once.current = true;
    api
      .confirmEmail(token)
      .then((r) => setState({ step: 'ok', email: r.email }))
      .catch((err) => setState({ step: 'failed', message: err.message || 'This link didn’t work' }));
  }, [token]);

  async function resend() {
    try {
      const r = await api.resendEmailLink();
      setResent(`A new link is on its way to ${r.emailPending || r.email}.`);
    } catch (err) {
      setResent(err.message || 'Couldn’t send a new link');
    }
  }

  const button = 'w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover';

  if (state.step === 'working') return <AuthShell title="Confirming your email…" subtitle="One moment." />;
  if (state.step === 'ok') {
    return (
      <AuthShell title="Email confirmed" subtitle={`${state.email} is now confirmed. It can be used to reset your password.`} pose="party">
        <button type="button" autoFocus onClick={onDone} className={button}>
          {signedIn ? 'Continue to DisGourd' : 'Sign in'}
        </button>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="That link didn’t work" subtitle={state.message} pose="confused">
      <div className="space-y-3">
        {signedIn ? (
          <button type="button" onClick={resend} className={button}>
            Send a new link
          </button>
        ) : (
          <p className="text-center text-sm text-gray-400">Sign in, then send a new link from Settings › My account › Email.</p>
        )}
        {resent && (
          <p role="status" className="text-center text-sm text-gray-300">
            {resent}
          </p>
        )}
        <button type="button" onClick={onDone} className="w-full rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-ink-700">
          {signedIn ? 'Back to DisGourd' : 'Go to sign in'}
        </button>
      </div>
    </AuthShell>
  );
}
