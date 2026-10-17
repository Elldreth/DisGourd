import { useRef } from 'react';

// Feature hooks (channel messages, DMs, voice, …) each contribute gateway frame
// handlers, and they need `send` and `status` from useGateway. To avoid a
// cycle, App passes useGateway one stable handler table up front, calls the
// feature hooks with the real `send`/`status`, then fills the table with
// everyone's handlers. useGateway looks handlers up when each frame arrives,
// so the table only has to be filled before the next frame, not before
// useGateway runs.
export function useHandlerTable() {
  const table = useRef(null);
  if (!table.current) {
    const handlers = {};
    // Replace the table's contents with these { frameType: handler } maps.
    // When several maps handle the same frame type (the open channel and the
    // open thread both take `message`), each one runs, in the order given.
    const fill = (...maps) => {
      for (const k of Object.keys(handlers)) delete handlers[k];
      Object.assign(handlers, composeHandlers(...maps));
    };
    table.current = { handlers, fill };
  }
  return table.current;
}

// One { frameType: handler } map from several: a frame type listed by more
// than one map gets a handler that calls each of theirs in turn.
export function composeHandlers(...maps) {
  const lists = {};
  for (const map of maps) {
    for (const [type, fn] of Object.entries(map || {})) {
      if (typeof fn !== 'function') continue;
      (lists[type] ||= []).push(fn);
    }
  }
  const out = {};
  for (const [type, fns] of Object.entries(lists)) {
    out[type] = fns.length === 1 ? fns[0] : (frame) => fns.forEach((fn) => fn(frame));
  }
  return out;
}
