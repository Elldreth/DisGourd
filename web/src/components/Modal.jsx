import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

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
// Rendered in a portal on <body>, above the app.

const TitleId = createContext(null);

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const focusables = (root) =>
  [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden');

export default function Modal({ onClose, children, panelClassName = '', initialFocusRef, closeOnBackdrop = true }) {
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
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return; // a control inside claimed it
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
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`anim-scale-in outline-hidden ${panelClassName}`}
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
