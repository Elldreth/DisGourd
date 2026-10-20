import { useRef } from 'react';
import Modal from './Modal.jsx';
import { SHORTCUT_GROUPS, isMac, keyNames } from '../shortcuts.js';
import { getPttEnabled, getPttKey, keyLabel } from '../audio.js';

// Keyboard shortcuts (P7-02): every shortcut the app has, from one list in
// shortcuts.js, so the sheet can't drift from what the keys actually do.
// Opens on Ctrl/⌘+/ and from the status menu.
export default function ShortcutsSheet({ onClose, mac = isMac() }) {
  const closeRef = useRef(null);
  const ptt = getPttEnabled() && getPttKey();
  return (
    <Modal onClose={onClose} label="Keyboard shortcuts" initialFocusRef={closeRef} panelClassName="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50">
      <div className="flex items-center justify-between border-b border-ink-500/40 px-6 py-4">
        <Modal.Title>Keyboard shortcuts</Modal.Title>
        <button ref={closeRef} type="button" onClick={onClose} className="rounded-sm px-2 text-sm text-gray-400 hover:text-fg">
          Close
        </button>
      </div>
      <div className="space-y-5 overflow-y-auto px-6 py-4">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.title}</h3>
            <dl className="space-y-1.5">
              {group.items.map((it) => (
                <div key={it.label} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-gray-200">{it.label}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keyNames(it.keys, mac).map((k) => (
                      <kbd key={k} className="rounded-md bg-ink-900 px-1.5 py-0.5 font-sans text-xs text-gray-300 ring-1 ring-ink-500/60">{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
              {group.title === 'Voice' && (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-gray-200">Push to talk (hold)</dt>
                  <dd className="shrink-0 text-xs text-gray-400">
                    {ptt ? <kbd className="rounded-md bg-ink-900 px-1.5 py-0.5 font-sans text-gray-300 ring-1 ring-ink-500/60">{keyLabel(getPttKey())}</kbd> : 'Off · set it in Voice & audio'}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
