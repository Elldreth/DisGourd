import { useImagine, ImagineLoading } from './ImagineSettings.jsx';

// Image generation › Variations: the Subtle and Strong buttons under an
// image (a loopback through image-to-image).
export default function VariationsPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy } = s;
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        Subtle and Strong variations are a loopback: each loop repaints the whole image at its strength (a new seed each time), runs the face detailer if
        it’s on, and feeds the result into the next loop. Around 0.3 keeps the picture; 0.6–0.7 keeps the layout but redraws details, pose and
        background; above 0.8 it’s mostly a new picture.
      </p>
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-ink-900/60 p-4">
        <div>
          <label htmlFor="imagine-vary-loops" className="mb-1 block text-xs text-gray-400">Loops</label>
          <select id="imagine-vary-loops" value={comfy.varyLoops} onChange={(e) => setComfy((c) => ({ ...c, varyLoops: Number(e.target.value) }))} className="input">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="imagine-vary-subtle" className="mb-1 block text-xs text-gray-400">Subtle strength</label>
          <input id="imagine-vary-subtle" type="number" min="0.1" max="0.6" step="0.05" value={comfy.varySubtle}
            onChange={(e) => setComfy((c) => ({ ...c, varySubtle: e.target.value }))} className="input" />
        </div>
        <div>
          <label htmlFor="imagine-vary-strong" className="mb-1 block text-xs text-gray-400">Strong strength</label>
          <input id="imagine-vary-strong" type="number" min="0.3" max="0.9" step="0.05" value={comfy.varyStrong}
            onChange={(e) => setComfy((c) => ({ ...c, varyStrong: e.target.value }))} className="input" />
        </div>
      </div>
      <p className="text-xs text-gray-500">ComfyUI only. With your own workflow, its image-to-image workflow is used if you gave one.</p>
    </div>
  );
}
