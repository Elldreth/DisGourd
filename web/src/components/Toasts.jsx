import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Small notices at the bottom of the screen ("Message deleted · Undo").
// Wrap the app in <ToastProvider>; anything inside calls
//   const toast = useToasts();
//   toast.show({ id?, message, actionLabel?, onAction?, duration = 5000, tone? })
//   toast.dismiss(id)
// Showing a toast with an existing id replaces it. Toasts are read out by
// screen readers (a polite live region) and never take focus; their action
// button is in the normal Tab order. tone: 'error' for failures.

const ToastContext = createContext({ show: () => {}, dismiss: () => {} });
export const useToasts = () => useContext(ToastContext);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    ({ id = `toast-${++nextId}`, message, actionLabel, onAction, duration = 5000, tone }) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
      setToasts((list) => [...list.filter((t) => t.id !== id), { id, message, actionLabel, onAction, tone }]);
      return id;
    },
    [dismiss]
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-60 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`anim-pop pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-xl ring-1 ${
              t.tone === 'error' ? 'bg-ink-900 text-danger ring-danger/40' : 'bg-ink-900 text-gray-100 ring-ink-500/60'
            }`}
          >
            <span>{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => {
                  dismiss(t.id);
                  t.onAction?.();
                }}
                className="font-semibold text-brand-hi hover:underline"
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
