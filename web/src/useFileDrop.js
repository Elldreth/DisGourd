import { useEffect, useRef, useState } from 'react';

// Drag files from your computer onto a chat panel to upload them.
//   const { dragging, dropProps } = useFileDrop({ enabled, onFiles });
//   <main {...dropProps}>… {dragging && <Overlay />}</main>
// Only drags that carry files count (not text, links, or reordering server
// icons). Entering a child element fires dragleave on its parent, so a
// counter tracks enter/leave pairs to keep the overlay from flickering.
export function useFileDrop({ enabled, onFiles }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };

  // A drag that ends outside the panel (dropped elsewhere, Esc, left the
  // window) never sends us dragleave for every enter, so clear on dragend/drop.
  useEffect(() => {
    if (!dragging) return undefined;
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
    };
  }, [dragging]);

  // A file dropped just outside the panel (on the sidebar, say) would make
  // the browser open it in place of the app. Swallow file drops elsewhere.
  useEffect(() => {
    if (!enabled) return undefined;
    const guard = (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, [enabled]);

  if (!enabled) return { dragging: false, dropProps: {} };

  const dropProps = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // allow dropping here
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) onFiles(files);
    },
  };
  return { dragging, dropProps };
}
