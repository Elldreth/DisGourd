import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS, addRecentEmoji, getRecentEmoji, loadEmoji, searchEmoji } from '../emoji.js';

const COLS = 8;

// Emoji picker: search (focused on open), Recent, and every category. The
// keyboard stays in the search box: arrows move the highlight, Enter picks,
// Esc closes. The emoji data loads the first time a picker opens.
export default function EmojiPicker({ onPick, onClose }) {
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(getRecentEmoji);
  const searchRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    searchRef.current?.focus();
    let live = true;
    loadEmoji()
      .then((l) => live && setList(l))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const byEmoji = useMemo(() => new Map((list || []).map((e) => [e.emoji, e])), [list]);
  const results = useMemo(() => (list && query.trim() ? searchEmoji(list, query) : null), [list, query]);

  // Sections shown: search results, or Recent + each category.
  const sections = useMemo(() => {
    if (!list) return [];
    if (results) return [{ key: 'results', name: 'Results', items: results }];
    const out = [];
    const rec = recent.map((e) => byEmoji.get(e) || { emoji: e, label: e }).filter(Boolean);
    if (rec.length) out.push({ key: 'recent', name: 'Recent', items: rec });
    for (const g of EMOJI_GROUPS) out.push({ key: `g${g.id}`, name: g.name, items: list.filter((e) => e.group === g.id) });
    return out;
  }, [list, results, recent, byEmoji]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  useEffect(() => setActive(0), [query]);

  // Keep the highlighted emoji in view.
  useEffect(() => {
    gridRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function pick(e) {
    addRecentEmoji(e.emoji);
    onPick(e.emoji);
  }

  function onKeyDown(e) {
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (move) {
      e.preventDefault();
      setActive((i) => Math.min(Math.max(i + move, 0), Math.max(flat.length - 1, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) pick(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  function jumpTo(key) {
    gridRef.current?.querySelector(`[data-section="${key}"]`)?.scrollIntoView?.({ block: 'start' });
  }

  let idx = 0;
  return (
    <div
      role="dialog"
      aria-label="Emoji picker"
      className="anim-pop flex h-96 w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/60"
    >
      <div className="p-2">
        <input
          ref={searchRef}
          type="search"
          aria-label="Search emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search emoji"
          className="w-full rounded-lg bg-ink-900 px-3 py-1.5 text-sm text-gray-100 outline-hidden ring-1 ring-ink-500 placeholder:text-gray-500 focus:ring-brand-hi"
        />
      </div>
      {!results && list && (
        <div className="flex gap-0.5 border-b border-ink-900/60 px-2 pb-1.5">
          {recent.length > 0 && (
            <button type="button" tabIndex={-1} title="Recent" aria-label="Recent" onClick={() => jumpTo('recent')} className="rounded-sm p-1 text-base hover:bg-ink-600">
              🕘
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button key={g.id} type="button" tabIndex={-1} title={g.name} aria-label={g.name} onClick={() => jumpTo(`g${g.id}`)} className="rounded-sm p-1 text-base hover:bg-ink-600">
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div ref={gridRef} role="listbox" aria-label="Emoji" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {failed && <p className="p-4 text-center text-sm text-pink">Couldn’t load emoji. Close and try again.</p>}
        {!list && !failed && <p className="p-4 text-center text-sm text-gray-500">Loading emoji…</p>}
        {results && results.length === 0 && <p className="p-4 text-center text-sm text-gray-500">No emoji found</p>}
        {sections.map((s) => (
          // content-visibility lets the browser skip laying out categories
          // that are scrolled out of view (there are ~1,900 emoji).
          <div key={s.key} role="group" aria-label={s.name} data-section={s.key} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}>
            {s.items.length > 0 && (
              <div className="sticky top-0 bg-ink-800 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{s.name}</div>
            )}
            <div className="grid grid-cols-8">
              {s.items.map((e) => {
                const i = idx++;
                return (
                  <button
                    key={`${s.key}-${e.emoji}`}
                    type="button"
                    role="option"
                    aria-label={e.label}
                    aria-selected={i === active}
                    tabIndex={-1}
                    data-idx={i}
                    title={e.shortcodes?.length ? `${e.label}  :${e.shortcodes[0]}:` : e.label}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(e)}
                    className={`flex h-9 items-center justify-center rounded-lg text-xl ${i === active ? 'bg-ink-600' : 'hover:bg-ink-600'}`}
                  >
                    {e.emoji}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-8 items-center gap-2 border-t border-ink-900/60 px-3 text-xs text-gray-400">
        {flat[active] && (
          <>
            <span className="text-base">{flat[active].emoji}</span>
            <span className="truncate">{flat[active].label}</span>
          </>
        )}
      </div>
    </div>
  );
}
