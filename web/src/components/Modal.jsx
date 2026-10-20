import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton.jsx';

// An accessible modal dialog. It draws the dimmed backdrop and an empty
// panel (styled by `panelClassName`); the dialog lays out its own content and
// names itself with <Modal.Title>.
//   - role="dialog", aria-modal, aria-labelledby -> the Modal.Title
//   - focus moves in (to `initialFocusRef`, which may be a control or a
//     container of them, or else to the first control), Tab and Shift+Tab
//     stay inside, and focus returns to the opener on close
//   - Esc closes, unless a control inside already handled it (preventDefault),
//     like a key-capture field
//   - clicking the backdrop closes (`closeOnBackdrop`), clicking inside doesn't
//   - the page behind doesn't scroll while it's open
// Rendered in a portal on <body>, above the app. Dialogs can nest (the avatar
// cropper over Settings): each one only handles keys from inside its own
// panel, and closing the top one returns focus into the one below.
//
// Options for overlays that aren't a plain centred card:
//   label             accessible name when there's no visible <Modal.Title>
//   backdropClassName replaces the backdrop's layout and colour
//                     (default "flex items-center justify-center bg-black/60 p-4")
//   fill              the panel covers the screen (a media viewer); a click on
//                     its own empty area counts as a backdrop click
//   animate           the panel's scale-in animation (default true)

const TitleId = createContext(null);

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Shown and focusable: not inside [hidden] or display:none, not invisible.
function shown(el, root) {
  if (el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') return false;
  for (let e = el; e && e !== root; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false;
  return true;
}
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => shown(el, root));

export default function Modal({
  onClose,
  children,
  panelClassName = '',
  initialFocusRef,
  closeOnBackdrop = true,
  label,
  backdropClassName = 'flex items-center justify-center bg-black/60 p-4',
  fill = false,
  animate = true,
}) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const want = initialFocusRef?.current;
      // initialFocusRef may be a control, or a container whose first control should get focus.
      const fromRef = want && (want.matches(FOCUSABLE) ? want : focusables(want)[0]);
      const target = fromRef || (panelRef.current && focusables(panelRef.current)[0]) || panelRef.current;
      target?.focus();
    });
    return () => {
      document.body.style.overflow = overflow;
      // Back to the opener; if it's gone or can't take focus (a control that
      // closed with a menu, a hidden file input), into the dialog below.
      if (opener && document.contains(opener)) opener.focus();
      if (document.activeElement !== opener) opener?.closest?.('[role=dialog]')?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e) {
    // Keys from a dialog stacked on top of this one bubble here through React;
    // they're not ours. Neither is a key a control already handled (the
    // push-to-talk key capture swallows every key, Esc and Tab included).
    if (e.defaultPrevented || !panelRef.current?.contains(e.target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(panelRef.current);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      data-testid="modal-backdrop"
      className={`anim-fade fixed inset-0 z-50 ${backdropClassName}`}
      onClick={(e) => {
        e.stopPropagation(); // a nested dialog's backdrop closes only that dialog
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          e.stopPropagation();
          if (fill && closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
        className={`${animate ? 'anim-scale-in' : ''} outline-hidden ${fill ? 'fixed inset-0' : ''} ${panelClassName}`}
      >
        <TitleId.Provider value={titleId}>{children}</TitleId.Provider>
      </div>
    </div>,
    document.body
  );
}

// The dialog's heading; it becomes the dialog's accessible name.
Modal.Title = function ModalTitle({ className = 'text-lg font-bold', children }) {
  return (
    <h3 id={useContext(TitleId)} className={className}>
      {children}
    </h3>
  );
};

// The standard dialog header (P5-02): the title (the dialog's name), an
// optional subtitle (a server's name, say) and an × button named Close.
Modal.Header = function ModalHeader({ title, subtitle, onClose, children }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-ink-500/40 py-3 pl-5 pr-3">
      <div className="min-w-0 flex-1">
        <Modal.Title className="truncate text-lg font-bold">{title}</Modal.Title>
        {subtitle && <p className="truncate text-xs text-gray-400">{subtitle}</p>}
      </div>
      {children}
      <IconButton icon="x" label="Close" onClick={onClose} className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-700 hover:text-fg" />
    </div>
  );
};
