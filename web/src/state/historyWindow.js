import { PAGE_SIZE } from './useHistoryPaging.js';

const HALF = Math.floor(PAGE_SIZE / 2);

// Reading older history in a channel or DM, shared by both message hooks.
// Jumping to a message that isn't loaded swaps the transcript for a window of
// history around it (the server sends 25 either side); from there you can load
// newer pages forwards, or jump straight back to the present.
//   key:        the paging key of the open conversation
//   isCurrent:  () => is that conversation still the open one?
//   fetchPage:  ({ around } | { limit, after } | {}) => Promise<rows>
//   onPresent(rows): back at the newest page (mark it read)
// While `hasNewer` is true the hooks hold live messages back (they're fetched
// by loadNewer / jumpToPresent instead), so the window never gets a gap.
export function historyWindow({ key, isCurrent, fetchPage, messages, dispatch, paging, onPresent }) {
  return {
    hasNewer: paging.hasNewer,
    loadingNewer: paging.loadingNewer,

    // Resolves true once the window around `id` is showing, false if the
    // message couldn't be loaded (deleted, not in this conversation, offline).
    async jumpAround(id) {
      let rows;
      try {
        rows = await fetchPage({ around: id });
      } catch {
        return false;
      }
      if (!isCurrent() || !rows.some((m) => m.id === id)) return false;
      dispatch({ type: 'reset', messages: rows });
      paging.pageLoaded(key, rows.filter((m) => m.id < id).length >= HALF ? PAGE_SIZE : 0);
      paging.setNewer(key, rows.filter((m) => m.id > id).length >= HALF);
      return true;
    },

    async jumpToPresent() {
      let rows;
      try {
        rows = await fetchPage({});
      } catch {
        return;
      }
      if (!isCurrent()) return;
      dispatch({ type: 'reset', messages: rows });
      paging.pageLoaded(key, rows.length);
      paging.setNewer(key, false);
      onPresent?.(rows);
    },

    loadNewer() {
      const newest = messages[messages.length - 1]?.id;
      if (!newest) return Promise.resolve();
      return paging.loadNewer(
        (limit) => fetchPage({ limit, after: newest }),
        (rows) => dispatch({ type: 'merged', messages: rows })
      );
    },
  };
}
