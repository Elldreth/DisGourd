import { useState } from 'react';
import * as api from '../../../api.js';
import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { SHAPES, QUALITIES, card } from './constants.js';

// Image generation › Try it: make a test image with the saved settings.
export default function TryPage() {
  const s = useImagine();
  const [tryForm, setTryForm] = useState({ engine: '', prompt: '', shape: 'square', quality: 'standard' });
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState(null);
  const [tryError, setTryError] = useState('');
  if (!s.ready) return <ImagineLoading />;
  const { data, dirty } = s;

  const savedComfy = data.engines.find((e) => e.id === 'comfyui')?.config || {};
  const kieEngine = data.engines.find((e) => e.id === 'kie');
  const savedKie = kieEngine?.config || {};
  const kieModels = kieEngine?.models || [];
  // Engines with saved settings.
  const tryEngines = [
    savedComfy.model && { id: 'comfyui', name: 'ComfyUI', detail: savedComfy.model },
    savedKie.model && (savedKie.keySaved || savedKie.envKey) && {
      id: 'kie', name: 'kie.ai', detail: savedKie.model === 'custom' ? savedKie.customModel : kieModels.find((m) => m.id === savedKie.model)?.name,
    },
  ].filter(Boolean);

  async function tryIt(e) {
    e.preventDefault();
    setTrying(true);
    setTryError('');
    setResult(null);
    try {
      setResult(await api.tryImagine({ ...tryForm, engine: tryForm.engine || tryEngines[0]?.id }));
    } catch (err) {
      setTryError(err.message || 'Could not generate');
    } finally {
      setTrying(false);
    }
  }

  return (
    <form onSubmit={tryIt} className={card} aria-label="Generate a test image">
      <div className="text-sm text-gray-300">Generate a test image</div>
      {!tryEngines.length ? (
        <p className="text-sm text-gray-500">Save an engine’s settings first.</p>
      ) : (
        <>
          <input
            value={tryForm.prompt}
            onChange={(e) => setTryForm((f) => ({ ...f, prompt: e.target.value }))}
            placeholder="a friendly gourd wearing a top hat"
            aria-label="Test prompt"
            maxLength={1000}
            className="input"
          />
          <div className="flex flex-wrap gap-2">
            {tryEngines.length > 1 && (
              <select aria-label="Engine" value={tryForm.engine || tryEngines[0].id} onChange={(e) => setTryForm((f) => ({ ...f, engine: e.target.value }))} className="input w-auto">
                {tryEngines.map((en) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            )}
            <select aria-label="Shape" value={tryForm.shape} onChange={(e) => setTryForm((f) => ({ ...f, shape: e.target.value }))} className="input w-auto">
              {SHAPES.map((sh) => <option key={sh.v} value={sh.v}>{sh.label}</option>)}
            </select>
            <select aria-label="Quality" value={tryForm.quality} onChange={(e) => setTryForm((f) => ({ ...f, quality: e.target.value }))} className="input w-auto">
              {QUALITIES.map((q) => <option key={q.v} value={q.v}>{q.label}</option>)}
            </select>
            <button
              type="submit"
              disabled={trying || dirty || !tryForm.prompt.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {trying ? 'Generating…' : 'Generate'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {dirty
              ? 'You have unsaved changes: save them first, since the test uses the saved settings.'
              : `Uses the saved settings (${(tryEngines.find((en) => en.id === tryForm.engine) || tryEngines[0]).detail}).`}
          </p>
        </>
      )}
      {tryError && <div role="alert" className="text-sm text-danger">{tryError}</div>}
      {result && (
        <figure>
          <img src={result.url} alt={`Test image: ${tryForm.prompt}`} className="max-h-80 max-w-full rounded-lg" />
          <figcaption className="mt-1 text-xs text-gray-400">
            {result.width && result.height ? `${result.width}×${result.height} · ` : ''}
            {(result.ms / 1000).toFixed(1)} s{result.cost != null ? ` · ${result.cost} credits` : ''}
          </figcaption>
        </figure>
      )}
    </form>
  );
}
