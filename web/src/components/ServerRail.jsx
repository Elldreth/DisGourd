import { useState } from 'react';
import { initials, colorForName } from '../util.js';

// The far-left rail of server (space) icons, Discord-style, plus create/join.
export default function ServerRail({ spaces, currentSpace, onSelect, onCreate, onJoin }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');

  async function submitCreate(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName('');
    setAdding(false);
  }

  async function submitJoin(e) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    await onJoin(trimmed);
    setCode('');
    setJoining(false);
  }

  return (
    <nav className="relative flex w-[72px] flex-col items-center gap-2 bg-ink-900 py-3">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-2xl">
        🥒
      </div>
      <div className="h-px w-8 bg-ink-500/50" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto">
        {spaces.map((s) => {
          const active = s.name === currentSpace;
          return (
            <button
              key={s.name}
              onClick={() => onSelect(s.name)}
              title={s.name}
              className={`group relative flex h-12 w-12 items-center justify-center font-semibold text-white transition-all duration-150 hover:rounded-2xl ${
                active ? 'rounded-2xl' : 'rounded-[26px]'
              }`}
              style={{ backgroundColor: active ? '#5b6ef5' : colorForName(s.name) }}
            >
              <span
                className={`absolute -left-3 w-1 rounded-r bg-white transition-all ${
                  active ? 'h-8' : 'h-0 group-hover:h-5'
                }`}
              />
              {initials(s.name)}
            </button>
          );
        })}

        {adding ? (
          <form onSubmit={submitCreate} className="px-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name && setAdding(false)}
              placeholder="name"
              className="w-14 rounded-lg bg-ink-700 px-1 py-1 text-center text-xs outline-none ring-1 ring-ink-500 focus:ring-brand"
            />
          </form>
        ) : (
          <button
            onClick={() => { setAdding(true); setJoining(false); }}
            title="Create a server"
            className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-2xl text-online transition-all hover:rounded-2xl hover:bg-online hover:text-white"
          >
            +
          </button>
        )}

        <button
          onClick={() => { setJoining((v) => !v); setAdding(false); }}
          title="Join a server with an invite"
          className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-xl text-gray-300 transition-all hover:rounded-2xl hover:bg-brand hover:text-white"
        >
          ⤵
        </button>
      </div>

      {joining && (
        <div className="absolute bottom-3 left-[76px] z-20 w-60 rounded-lg bg-ink-800 p-3 shadow-xl ring-1 ring-ink-500/50">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Join a server
          </div>
          <form onSubmit={submitJoin}>
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste invite code"
              className="input"
            />
            <div className="mt-2 flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => setJoining(false)}
                className="rounded px-2 py-1 text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-brand px-3 py-1 font-semibold text-white hover:bg-brand-hover"
              >
                Join
              </button>
            </div>
          </form>
        </div>
      )}
    </nav>
  );
}
