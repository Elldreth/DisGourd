import { useState } from 'react';
import { initials, colorForName } from '../util.js';

// The far-left rail of server (space) icons, Discord-style.
export default function ServerRail({ spaces, currentSpace, onSelect, onCreate }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function submit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName('');
    setAdding(false);
  }

  return (
    <nav className="flex w-[72px] flex-col items-center gap-2 bg-ink-900 py-3">
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
              className={`group relative flex h-12 w-12 items-center justify-center rounded-[26px] font-semibold text-white transition-all duration-150 hover:rounded-2xl ${
                active ? 'rounded-2xl' : ''
              }`}
              style={{ backgroundColor: active ? 'var(--brand, #5b6ef5)' : colorForName(s.name) }}
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
          <form onSubmit={submit} className="px-1">
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
            onClick={() => setAdding(true)}
            title="Create a server"
            className="flex h-12 w-12 items-center justify-center rounded-[26px] bg-ink-700 text-2xl text-online transition-all hover:rounded-2xl hover:bg-online hover:text-white"
          >
            +
          </button>
        )}
      </div>
    </nav>
  );
}
