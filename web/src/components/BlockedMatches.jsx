import Avatar from './Avatar.jsx';

// People you've blocked whose names match a search (P10-03). The pickers
// leave blocked people out; without this, searching for one said "No one by
// that name", as if they'd left. Each shows greyed, with Unblock.
//   <BlockedMatches query={q} blocked={['dee']} onUnblock={(name) => …} returnFocusTo={inputRef} />
// The Unblock button goes away once it's done, so focus returns to the
// search box (`returnFocusTo`) and Esc still closes the picker.
export function blockedMatching(blocked = [], query = '') {
  const q = query.trim().toLowerCase();
  return q ? blocked.filter((u) => u.toLowerCase().includes(q)).slice(0, 3) : [];
}

export default function BlockedMatches({ query, blocked = [], onUnblock, returnFocusTo }) {
  const matches = blockedMatching(blocked, query);
  if (!matches.length) return null;
  return (
    <ul aria-label="People you’ve blocked" className="px-2 pb-2">
      {matches.map((u) => (
        <li key={u} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-500">
          <span className="grayscale">
            <Avatar name={u} size={24} />
          </span>
          <span className="truncate">{u}</span>
          <span className="text-xs">· You blocked them</span>
          {onUnblock && (
            <button
              type="button"
              onClick={() => {
                returnFocusTo?.current?.focus();
                onUnblock(u);
              }}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-hi hover:bg-ink-700">
              Unblock
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
