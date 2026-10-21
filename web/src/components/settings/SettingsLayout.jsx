import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Icon from '../Icon.jsx';
import IconButton from '../IconButton.jsx';
import { useOverlayHistory } from '../../overlayHistory.js';

// The body of every settings window (P5-02): a list of sections and the chosen
// section's page.
//   - Desktop (md and up): the list is a column on the left, the page scrolls
//     on its own beside it. The window around it has a fixed size, so nothing
//     moves when you switch sections.
//   - Phones: the list fills the window first; choosing a section opens its
//     page with a Back button (and the hardware back button returns too).
// Sections stay mounted while hidden, so an edit in one survives a look at
// another. The list is a tablist: arrows move and select, Home/End jump,
// Enter or Space opens the section and puts focus in it.
//
//   sections       [{ id, label, group?, indent?, badge? }]; `group` starts a
//                  labelled group at its first item, `indent` marks a sub-page,
//                  `badge` ({ count, label }) shows an amber count (P10-01)
//   section        the chosen id; onSection(id) changes it
//   renderSection  (id) => the section's content (the layout adds its heading)
//   startOnPage    phones open on the chosen page instead of the list
//   history        false turns off the back-button entry (tests)
const phoneWidth = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

export default function SettingsLayout({ label, sections, section, onSection, renderSection, startOnPage = false, history = true }) {
  const [view, setView] = useState(startOnPage ? 'page' : 'list');
  const baseId = useId();
  const tabId = (id) => `${baseId}-tab-${id}`;
  const panelId = (id) => `${baseId}-panel-${id}`;
  const tabRefs = useRef({});
  const bodyRef = useRef(null);
  const ids = sections.map((s) => s.id);

  useOverlayHistory('settings-page', view === 'page', () => back(), {
    win: history && typeof window !== 'undefined' ? window : null,
    enabled: phoneWidth,
  });

  // A new section starts at its top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [section]);

  function openPage(id, focus) {
    flushSync(() => {
      onSection(id);
      setView('page');
    });
    if (focus) document.getElementById(panelId(id))?.focus();
  }

  function onTabKey(e) {
    const i = ids.indexOf(section);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = ids[(i + ids.length - 1) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPage(section, true);
      return;
    }
    if (!next) return;
    e.preventDefault();
    onSection(next);
    tabRefs.current[next]?.focus();
  }

  function back() {
    setView('list');
    requestAnimationFrame(() => tabRefs.current[section]?.focus());
  }

  let lastGroup;
  return (
    <div data-view={view} className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="vertical"
        className={`${view === 'page' ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3 md:flex md:w-56 md:flex-none md:border-r md:border-ink-500/40`}
      >
        {sections.map((s) => {
          const heading = s.group && s.group !== lastGroup;
          lastGroup = s.group;
          const active = section === s.id;
          return [
            heading && (
              <div key={`g-${s.group}`} className="mt-4 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {s.group}
              </div>
            ),
            <button
              key={s.id}
              ref={(el) => (tabRefs.current[s.id] = el)}
              type="button"
              role="tab"
              id={tabId(s.id)}
              aria-selected={active}
              aria-controls={panelId(s.id)}
              tabIndex={active ? 0 : -1}
              onClick={() => openPage(s.id, false)}
              onKeyDown={onTabKey}
              className={`tap-row flex w-full items-center rounded-lg py-2.5 text-left text-[15px] transition md:py-1.5 md:text-sm ${s.indent ? 'pl-6 pr-3' : 'px-3'} ${
                active ? 'md:bg-ink-600 md:text-fg text-gray-200' : 'text-gray-400 hover:bg-ink-700/60 hover:text-gray-200'
              }`}
            >
              {s.label}
              {s.badge?.count > 0 && (
                <span className="ml-2 rounded-full bg-idle px-1.5 text-xs font-bold text-ink-900" aria-label={s.badge.label}>
                  {s.badge.count > 99 ? '99+' : s.badge.count}
                </span>
              )}
              <Icon name="chevronLeft" size={16} className="ml-auto rotate-180 text-gray-500 md:hidden" />
            </button>,
          ];
        })}
      </div>

      <div className={`${view === 'list' ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col md:flex`}>
        <div className="flex items-center border-b border-ink-500/40 px-1 py-1 md:hidden">
          <IconButton icon="chevronLeft" label="Back to all settings" onClick={back} className="tap rounded-lg p-2 text-gray-300 transition hover:bg-ink-700 hover:text-fg" />
          <span aria-hidden="true" className="text-sm text-gray-400">
            All settings
          </span>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-8 md:py-6">
          {sections.map((s) => (
            <section
              key={s.id}
              role="tabpanel"
              id={panelId(s.id)}
              aria-labelledby={tabId(s.id)}
              tabIndex={-1}
              hidden={section !== s.id}
              className="outline-hidden"
            >
              <h2 className="mb-5 text-lg font-semibold text-fg">{s.label}</h2>
              {renderSection(s.id)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
