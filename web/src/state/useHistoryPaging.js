import { useCallback, useEffect, useRef, useState } from 'react';

export const PAGE_SIZE = 50;

// Paging state for scrolling back through one conversation's history (a
// channel or a DM), identified by `key`. A full page means there may be more;
// a short page means we've reached the start.
//
//   pageLoaded(key, count)       record a page that just loaded (initial or older)
//   loadOlder(fetchPage, apply)  fetch the next older page once (no-op while one
//                                is in flight or when there's no more); results
//                                for a conversation you've since left are dropped
// After jumping into older history (a window that doesn't reach the present):
//   setNewer(key, bool)          whether there are newer messages than shown
//   loadNewer(fetchPage, apply)  like loadOlder, forwards; a short page means
//                                we're back at the present (hasNewer turns off)
export function useHistoryPaging(key) {
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  const inFlight = useRef(null); // key of the load in progress
  const hasMoreRef = useRef(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const hasNewerRef = useRef(false);
  const newerInFlight = useRef(null);

  useEffect(() => {
    hasMoreRef.current = false;
    setHasMore(false);
    setLoadingOlder(false);
    inFlight.current = null;
    hasNewerRef.current = false;
    setHasNewer(false);
    setLoadingNewer(false);
    newerInFlight.current = null;
  }, [key]);

  const pageLoaded = useCallback((k, count) => {
    if (k !== keyRef.current) return;
    hasMoreRef.current = count >= PAGE_SIZE;
    setHasMore(hasMoreRef.current);
  }, []);

  const loadOlder = useCallback(async (fetchPage, apply) => {
    const k = keyRef.current;
    if (!hasMoreRef.current || inFlight.current === k) return;
    inFlight.current = k;
    setLoadingOlder(true);
    try {
      const rows = await fetchPage(PAGE_SIZE);
      if (k !== keyRef.current) return; // switched away mid-load
      apply(rows);
      pageLoaded(k, rows.length);
    } catch {
      /* leave hasMore as it was; scrolling up again retries */
    } finally {
      if (inFlight.current === k) {
        inFlight.current = null;
        setLoadingOlder(false);
      }
    }
  }, [pageLoaded]);

  const setNewer = useCallback((k, value) => {
    if (k !== keyRef.current) return;
    hasNewerRef.current = value;
    setHasNewer(value);
  }, []);

  const loadNewer = useCallback(async (fetchPage, apply) => {
    const k = keyRef.current;
    if (!hasNewerRef.current || newerInFlight.current === k) return;
    newerInFlight.current = k;
    setLoadingNewer(true);
    try {
      const rows = await fetchPage(PAGE_SIZE);
      if (k !== keyRef.current) return;
      apply(rows);
      setNewer(k, rows.length >= PAGE_SIZE);
    } catch {
      /* leave hasNewer as it was; scrolling down again retries */
    } finally {
      if (newerInFlight.current === k) {
        newerInFlight.current = null;
        setLoadingNewer(false);
      }
    }
  }, [setNewer]);

  return { hasMore, loadingOlder, pageLoaded, loadOlder, hasNewer, loadingNewer, hasNewerRef, setNewer, loadNewer };
}
