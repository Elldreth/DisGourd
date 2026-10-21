import { useId, useState } from 'react';
import * as api from '../api.js';
import { copyText } from '../util.js';
import { inviteLink } from '../inviteLink.js';
import AuthShell, { Field } from './AuthShell.jsx';
import TemplatePicker from './TemplatePicker.jsx';

// First-run wizard, shown when the server has no accounts yet:
//   1. the admin account (the first account is the owner & site admin)
//   2. who can create accounts here (the registration mode)
//   3. an optional first server
//   4. a ready-to-send message for friends (address, codes), then into the app
// The account is signed in after step 1, but the app only opens at the end.

const MODES = [
  {
    v: 'code',
    title: 'Invite code',
    badge: 'Recommended for friend groups',
    text: 'People need a registration code from you to create an account.',
  },
  { v: 'open', title: 'Open', text: 'Anyone who can reach this address can create an account.' },
  {
    v: 'closed',
    title: 'Closed',
    text: 'No one else can create an account. Use this for a server only you use, or to lock it later.',
  },
];

const STEPS = 4;

// `needsCode` (P11-01): the server wants its one-time setup code for the first account.
export default function SetupWizard({ onAuthed, needsCode = false }) {
  const [step, setStep] = useState(1);
  const [token, setTokenState] = useState('');
  const [reg, setReg] = useState(null); // { mode, envCodeActive } as the server had it
  const [mode, setMode] = useState('open');
  const [server, setServer] = useState(''); // name of the server created in step 3
  const [invite, setInvite] = useState('');

  const titles = {
    1: 'Set up your DisGourd server',
    2: 'Who can join?',
    3: 'Create your first server',
    4: 'You’re all set',
  };
  const subtitles = {
    1: (
      <>
        This is a brand-new server. Create the first account; it becomes the
        <span className="font-semibold text-gray-300"> owner &amp; site admin</span>.
      </>
    ),
    2: 'Choose who can create an account here. You can change this any time in Settings → Registration & access.',
    3: 'A server is where your channels live. You can make more later.',
    4: server ? 'Send this to your friends so they can join you.' : 'You can create a server and invite people from the app.',
  };

  return (
    <AuthShell title={titles[step]} subtitle={subtitles[step]} pose={step === 4 ? 'party' : 'wave'}>
      <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
        Step {step} of {STEPS}
      </p>
      {step === 1 && (
        <AccountStep
          needsCode={needsCode}
          onDone={async (tok) => {
            setTokenState(tok);
            const r = await api.getAdminRegistration().catch(() => ({ mode: 'open' }));
            setReg(r);
            setMode(r.mode || 'open');
            setStep(2);
          }}
        />
      )}
      {step === 2 && <ModeStep reg={reg} mode={mode} setMode={setMode} onDone={() => setStep(3)} />}
      {step === 3 && (
        <ServerStep
          onDone={(name, code) => {
            setServer(name);
            setInvite(code);
            setStep(4);
          }}
        />
      )}
      {step === 4 && <FinishStep mode={mode} server={server} invite={invite} onOpen={() => onAuthed(token)} />}
    </AuthShell>
  );
}

function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
      {error}
    </div>
  );
}

function Primary({ busy, busyLabel, children, ...rest }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover active:scale-[.98] disabled:opacity-60 disabled:active:scale-100"
      {...rest}
    >
      {busy ? busyLabel : children}
    </button>
  );
}

// Run an async step action with busy + inline error handling.
function useStepAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn, fallback) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message || fallback);
    }
    setBusy(false);
  }
  return { busy, error, run };
}

function AccountStep({ onDone, needsCode }) {
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useStepAction();

  function submit(e) {
    e.preventDefault();
    run(async () => {
      const res = needsCode
        ? await api.register(username.trim(), password, email.trim(), undefined, setupCode.trim())
        : await api.register(username.trim(), password, email.trim());
      api.setToken(res.token);
      await onDone(res.token);
    }, 'Could not create the account');
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {needsCode && (
        <div>
          <Field label="Setup code" hint="From the server">
            <input autoFocus value={setupCode} onChange={(e) => setSetupCode(e.target.value)} className="input font-mono" autoComplete="off" spellCheck={false} aria-describedby="setup-code-help" />
          </Field>
          <p id="setup-code-help" className="mt-1 text-xs text-gray-500">
            It's printed in the server's log when it starts, and saved in the <code>.setup-code</code> file next to the database.
          </p>
        </div>
      )}
      <Field label="Admin username">
        <input autoFocus={!needsCode} value={username} onChange={(e) => setUsername(e.target.value)} className="input" placeholder="your_name" autoComplete="username" />
      </Field>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="you@example.com" autoComplete="email" />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" placeholder="••••••••" autoComplete="new-password" />
      </Field>
      <ErrorNote error={error} />
      <Primary busy={busy} busyLabel="Creating account…">Create admin account</Primary>
    </form>
  );
}

function ModeStep({ reg, mode, setMode, onDone }) {
  const { busy, error, run } = useStepAction();
  const name = useId();
  // The mode starts as 'open' unless REGISTRATION_MODE / REGISTRATION_CODE seeded it.
  const preset = reg && (reg.mode !== 'open' || reg.envCodeActive);

  function submit(e) {
    e.preventDefault();
    run(async () => {
      if (mode !== reg?.mode) await api.setRegistrationMode(mode);
      onDone();
    }, 'Could not save that choice');
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Who can create an account</legend>
        {MODES.map((m) => (
          <label
            key={m.v}
            className={`flex cursor-pointer gap-3 rounded-lg p-3 ring-1 transition ${
              mode === m.v ? 'bg-ink-700 ring-brand-hi' : 'ring-ink-500 hover:bg-ink-700/60'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={m.v}
              checked={mode === m.v}
              onChange={() => setMode(m.v)}
              className="mt-1 h-4 w-4 shrink-0 accent-brand"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-semibold text-gray-100">
                {m.title}
                {m.badge && (
                  <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-semibold text-brand-hi">{m.badge}</span>
                )}
              </span>
              <span className="mt-0.5 block text-sm text-gray-400">{m.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {preset && (
        <p className="rounded-lg bg-ink-900 px-3 py-2 text-xs text-gray-400">
          Your server config set the starting choice (<code>REGISTRATION_MODE</code>
          {reg.envCodeActive && (
            <>
              {' '}/ <code>REGISTRATION_CODE</code>, which also keeps working as a code
            </>
          )}
          ). That only applies on first run; what you pick here wins from now on.
        </p>
      )}
      <ErrorNote error={error} />
      <Primary busy={busy} busyLabel="Saving…">Continue</Primary>
    </form>
  );
}

function ServerStep({ onDone }) {
  const [name, setName] = useState('My Community');
  const [template, setTemplate] = useState('blank');
  const { busy, error, run } = useStepAction();

  function submit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    run(async () => {
      await api.createSpace(trimmed, template);
      // The invite is a nice-to-have; a server without one is still a success.
      const inv = await api.createInvite(trimmed).catch(() => null);
      onDone(trimmed, inv?.code || '');
    }, 'Could not create the server');
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Server name" hint={`${name.length}/60`}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="My Community" />
      </Field>
      <TemplatePicker value={template} onChange={setTemplate} />
      <ErrorNote error={error} />
      <Primary busy={busy} busyLabel="Creating…" disabled={busy || !name.trim()}>
        Create server
      </Primary>
      <button type="button" onClick={() => onDone('', '')} className="w-full rounded-lg px-4 py-2 text-sm text-gray-400 transition hover:text-fg">
        Skip for now
      </button>
    </form>
  );
}

function FinishStep({ mode, server, invite, onOpen }) {
  const [regCode, setRegCode] = useState('');
  const [copied, setCopied] = useState(''); // 'link' | 'message' — the one just copied
  const { busy, error, run } = useStepAction();
  const address = window.location.origin;
  const link = invite ? inviteLink(invite, address) : '';
  const linkId = useId();

  // With an invite, the link itself opens the Join dialog once they're signed in.
  const lines = [`Join me on DisGourd: ${link || address}`];
  if (mode === 'code') lines.push(regCode ? `1. Create an account with this registration code: ${regCode}` : '1. Create an account (ask me for a registration code)');
  else if (mode === 'open') lines.push('1. Create an account');
  if (invite) lines.push(`${mode === 'closed' ? 'Sign in, then' : '2. Then'} press Enter to join (invite code, if you need it: ${invite})`);
  const message = lines.join('\n');

  return (
    <div className="space-y-4">
      {server && (
        <>
          <p className="text-sm text-gray-300">
            <span className="font-semibold text-gray-100">{server}</span> is ready.
          </p>
          {mode === 'closed' && (
            <p className="rounded-lg bg-idle/10 px-3 py-2 text-xs text-idle">
              Registration is closed, so only people who already have an account here can use the invite.
            </p>
          )}
          {mode === 'code' && !regCode && (
            <button
              type="button"
              onClick={() => run(async () => setRegCode((await api.createRegCode({})).code), 'Could not create a code')}
              disabled={busy}
              className="w-full rounded-lg bg-ink-600 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:bg-ink-500 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create a registration code'}
            </button>
          )}
          <ErrorNote error={error} />
          {invite && (
            <>
              {/* P7-01: the link first; most people paste a link, not a paragraph. */}
              <div>
                <label htmlFor={linkId} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Invite link
                </label>
                <div className="flex gap-2">
                  <input id={linkId} readOnly value={link} onFocus={(e) => e.target.select()} className="input min-w-0 flex-1 font-mono text-xs" />
                  <button
                    type="button"
                    onClick={async () => setCopied((await copyText(link)) ? 'link' : '')}
                    className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hover"
                  >
                    {copied === 'link' ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">Invites never expire; make more from the server menu.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Or send a message with the steps
                  <textarea readOnly value={message} rows={5} className="input mt-1 resize-none font-mono text-xs normal-case tracking-normal" />
                </label>
                <button
                  type="button"
                  onClick={async () => setCopied((await copyText(message)) ? 'message' : '')}
                  className="mt-2 rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-semibold text-gray-100 transition hover:bg-ink-500"
                >
                  {copied === 'message' ? 'Copied' : 'Copy message'}
                </button>
              </div>
            </>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-lg bg-brand px-4 py-2.5 font-semibold text-white transition hover:bg-brand-hover active:scale-[.98]"
      >
        Open DisGourd
      </button>
    </div>
  );
}
