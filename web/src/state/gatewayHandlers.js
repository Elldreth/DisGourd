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
    // Later maps win if two define the same frame type.
    const fill = (...maps) => {
      for (const k of Object.keys(handlers)) delete handlers[k];
      Object.assign(handlers, ...maps);
    };
    table.current = { handlers, fill };
  }
  return table.current;
}
