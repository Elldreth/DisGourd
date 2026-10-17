import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

// Actions on a single message. Every surface — the hover/focus toolbar, the
// "…" menu, the right-click menu and the touch bottom sheet — renders the same
// `actions` list, so a feature adds its item once (Reply, Pin, …):
//   { id, label, icon, onSelect, danger?, quick? }
// `quick` items also get a one-click button in the toolbar.

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '✅'];

// Arrow / Home / End movement between the focusable children of a container.
function moveFocus(container, e, horizontal) {
  const items = [...container.querySelectorAll('[data-menu-item]')];
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  const next = horizontal ? 'ArrowRight' : 'ArrowDown';
  const prev = horizontal ? 'ArrowLeft' : 'ArrowUp';
  let to = null;
  if (e.key === next) to = (idx + 1) % items.length;
  else if (e.key === prev) to = (idx - 1 + items.length) % items.length;
  else if (e.key === 'Home') to = 0;
  else if (e.key === 'End') to = items.length - 1;
  if (to === null) return;
  e.preventDefault();
  e.stopPropagation();
  items[to].focus();
}

function useAutoFocusFirst(ref) {
  useEffect(() => {
    ref.current?.querySelector('[data-menu-item]')?.focus();
  }, [ref]);
}

// The strip of buttons shown on hover (pointer devices) or while the message
// row has keyboard focus. Hidden on touch-only devices, which use long-press.
export function MessageToolbar({ actions, onOpenMenu, forceVisible }) {
  const quick = actions.filter((a) => a.quick);
  return (
    <div
      className={`absolute -top-3 right-3 z-10 items-center gap-1 rounded-md border border-ink-500/60 bg-ink-800 px-1 py-0.5 shadow ${
        forceVisible ? 'flex' : 'hidden group-focus-within:flex [@media(hover:hover)]:group-hover:flex'
      }`}
    >
      {quick.map((a) => (
        <button
          key={a.id}
          type="button"
          tabIndex={-1}
          onClick={(e) => a.onSelect(e)}
          title={a.label}
          aria-label={a.label}
          className={`rounded-sm p-1 text-gray-400 hover:bg-ink-600 ${a.danger ? 'hover:text-danger' : 'hover:text-white'}`}
        >
          <Icon name={a.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        onClick={onOpenMenu}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        className="rounded-sm p-1 text-gray-400 hover:bg-ink-600 hover:text-white"
      >
        <Icon name="more" size={16} />
      </button>
    </div>
  );
}

// The full action list. `sheet` renders it as a bottom sheet (touch);
// otherwise it's a popover under the toolbar. Esc / outside click closes it.
// `above` opens the popover upward, for rows near the bottom of the list.
export function ActionMenu({ actions, sheet, above, onClose, label }) {
  const ref = useRef(null);
  useAutoFocusFirst(ref);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    moveFocus(ref.current, e, false);
  };

  const items = actions.map((a) => (
    <button
      key={a.id}
      type="button"
      role="menuitem"
      data-menu-item
      onClick={(e) => a.onSelect(e)}
      className={`flex w-full items-center gap-3 rounded-md text-left outline-hidden focus-visible:bg-ink-600 hover:bg-ink-600 ${
        sheet ? 'px-4 py-3 text-base' : 'px-3 py-1.5 text-sm'
      } ${a.danger ? 'text-danger' : 'text-gray-200'}`}
    >
      <Icon name={a.icon} size={sheet ? 20 : 16} />
      {a.label}
    </button>
  ));

  if (sheet) {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
        <div
          ref={ref}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="anim-pop w-full rounded-t-2xl border-t border-ink-500/60 bg-ink-800 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl"
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-500" aria-hidden="true" />
          {items}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={`anim-pop absolute right-3 z-30 min-w-44 rounded-lg border border-ink-500/60 bg-ink-900 p-1 shadow-xl ${
          above ? 'bottom-full mb-4' : 'top-6'
        }`}
      >
        {items}
      </div>
    </>
  );
}

// Emoji choices for a reaction. Left/Right move, Enter picks, Esc closes.
export function ReactionPicker({ onPick, onClose, sheet, above }) {
  const ref = useRef(null);
  useAutoFocusFirst(ref);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    moveFocus(ref.current, e, true);
  };

  const buttons = REACTION_EMOJIS.map((emoji) => (
    <button
      key={emoji}
      type="button"
      role="menuitem"
      data-menu-item
      aria-label={`React with ${emoji}`}
      onClick={() => onPick(emoji)}
      className={`rounded outline-hidden hover:bg-ink-600 focus-visible:bg-ink-600 focus-visible:ring-2 focus-visible:ring-brand-hi ${
        sheet ? 'p-2 text-2xl' : 'p-1 text-lg'
      }`}
    >
      {emoji}
    </button>
  ));

  if (sheet) {
    return (
      <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
        <div
          ref={ref}
          role="menu"
          aria-label="Add reaction"
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
          className="anim-pop flex w-full flex-wrap justify-center gap-1 rounded-t-2xl border-t border-ink-500/60 bg-ink-800 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
        >
          {buttons}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label="Add reaction"
        onKeyDown={onKeyDown}
        className={`anim-pop absolute right-3 z-30 flex gap-1 rounded-lg border border-ink-500/60 bg-ink-900 p-1.5 shadow-xl ${
          above ? 'bottom-full mb-4' : 'top-6'
        }`}
      >
        {buttons}
      </div>
    </>
  );
}
