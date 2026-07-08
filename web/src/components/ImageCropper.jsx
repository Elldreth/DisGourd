import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Lets you frame a non-square image before it becomes an avatar or server icon.
// The preview window IS the final mask (a circle for avatars, a rounded square
// for server icons), so dragging and zooming is fully WYSIWYG. On save we render
// exactly what's visible to a square canvas and hand back a fresh image File —
// no schema changes, since everything downstream already shows images cover-fit.
const V = 264; // on-screen preview size
const OUT = 320; // exported image size (square)

// `src` is a freshly-picked File (new upload) or a URL string pointing at an
// already-uploaded original (re-framing). `initialCrop` restores a saved framing.
export default function ImageCropper({ src, shape = 'circle', title = 'Position your image', initialCrop = null, onCancel, onSave }) {
  const [url, setUrl] = useState('');
  const [nat, setNat] = useState(null); // natural { w, h }
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);
  const boxRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    if (typeof src === 'string') {
      setUrl(src);
      return undefined;
    }
    const u = URL.createObjectURL(src);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [src]);

  const baseScale = nat ? Math.max(V / nat.w, V / nat.h) : 1;
  const dispW = nat ? nat.w * baseScale * zoom : V;
  const dispH = nat ? nat.h * baseScale * zoom : V;

  // Keep the image covering the window — no blank gaps at the edges.
  function clamp(o, dW = dispW, dH = dispH) {
    return {
      x: Math.min(0, Math.max(V - dW, o.x)),
      y: Math.min(0, Math.max(V - dH, o.y)),
    };
  }

  function onImgLoad(e) {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    const bs = Math.max(V / w, V / h);
    setNat({ w, h });
    if (initialCrop && initialCrop.zoom) {
      // Restore a saved framing: place its center back under the window center.
      const z = Math.min(3, Math.max(1, initialCrop.zoom));
      const scale = bs * z;
      setZoom(z);
      setOffset(
        clamp({ x: V / 2 - initialCrop.cx * w * scale, y: V / 2 - initialCrop.cy * h * scale }, w * scale, h * scale)
      );
    } else {
      setZoom(1);
      setOffset({ x: (V - w * bs) / 2, y: (V - h * bs) / 2 });
    }
  }

  function onPointerDown(e) {
    boxRef.current?.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    setOffset(
      clamp({ x: drag.current.ox + (e.clientX - drag.current.px), y: drag.current.oy + (e.clientY - drag.current.py) })
    );
  }
  function endDrag() {
    drag.current = null;
  }

  // Zoom around the window's center so the framed subject stays put.
  function applyZoom(next) {
    if (!nat) return;
    const z = Math.min(3, Math.max(1, next));
    const newW = nat.w * baseScale * z;
    const newH = nat.h * baseScale * z;
    const fracX = (V / 2 - offset.x) / dispW;
    const fracY = (V / 2 - offset.y) / dispH;
    setZoom(z);
    setOffset(clamp({ x: V / 2 - fracX * newW, y: V / 2 - fracY * newH }, newW, newH));
  }

  // Native, non-passive wheel handler so we can preventDefault the page scroll.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e) => {
      e.preventDefault();
      applyZoom(zoom - e.deltaY * 0.0016);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, offset, nat]);

  async function save() {
    if (!nat) return;
    setBusy(true);
    try {
      const scale = baseScale * zoom;
      const srcSize = V / scale;
      const canvas = document.createElement('canvas');
      canvas.width = OUT;
      canvas.height = OUT;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgRef.current, -offset.x / scale, -offset.y / scale, srcSize, srcSize, 0, 0, OUT, OUT);
      const name = typeof src === 'string' ? src.split('/').pop() : src.name || 'image';
      const keepAlpha = /\.(png|webp|gif|svg)/i.test(name) || (typeof src !== 'string' && /png|webp|gif|svg/.test(src.type));
      const type = keepAlpha ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((res) => canvas.toBlob(res, type, 0.9));
      const base = name.replace(/\.[^.]+$/, '') || 'image';
      const out = new File([blob], `${base}.${keepAlpha ? 'png' : 'jpg'}`, { type });
      // Normalized crop box — the window's center within the original + zoom —
      // so this exact framing can be restored on a later re-frame.
      const crop = { zoom, cx: (V / 2 - offset.x) / scale / nat.w, cy: (V / 2 - offset.y) / scale / nat.h };
      await onSave({ blob: out, crop });
    } finally {
      setBusy(false);
    }
  }

  const mask = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  return (
    <div
      className="anim-fade absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="anim-scale-in w-full max-w-sm rounded-xl bg-ink-800 p-6 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-bold">{title}</h3>
        <p className="mb-4 text-sm text-gray-400">Drag to reposition, and zoom to frame it just right.</p>

        <div className="flex justify-center">
          <div
            ref={boxRef}
            className={`relative touch-none select-none overflow-hidden bg-ink-900 ring-2 ring-brand/40 ${mask}`}
            style={{ width: V, height: V, cursor: drag.current ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {url && (
              <img
                ref={imgRef}
                src={url}
                alt=""
                draggable={false}
                onLoad={onImgLoad}
                className="pointer-events-none absolute max-w-none"
                style={{ width: dispW, height: dispH, left: offset.x, top: offset.y }}
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Icon name="image" size={16} className="shrink-0 text-gray-500" />
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => applyZoom(parseFloat(e.target.value))}
            aria-label="Zoom"
            className="h-1 flex-1 accent-brand"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:text-white">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || !nat}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover active:scale-95 disabled:opacity-60 disabled:active:scale-100"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
