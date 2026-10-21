import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { heading, card, priceLabel } from './constants.js';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';

// Image generation › kie.ai: the key, the model and a monthly spending cap.
export default function KiePage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { data, kie, setKie, kieKey, setKieKey, kieNote, testKie } = s;
  const kieEngine = data.engines.find((e) => e.id === 'kie');
  const savedKie = kieEngine?.config || {};
  const kieModels = kieEngine?.models || [];
  const kieModel = kieModels.find((m) => m.id === kie.model);
  // Pictures (P9-05b): the model's own picture version, else the one picked here.
  const pictureModels = kieModels.filter((m) => m.picture);
  const needsPictureModel = !!kie.model && !kieModel?.picture;
  const picturesBy = kieModel?.picture ? kieModel : needsPictureModel ? pictureModels.find((m) => m.id === kie.pictureModel) : null;

  return (
    <div className="space-y-5">
      <SettingRow label="Use kie.ai (paid, with your API key)" description="A hosted service: pay per image, no graphics card needed.">
        <Switch label="Use kie.ai (paid, with your API key)" checked={kie.enabled} onChange={(on) => setKie((k) => ({ ...k, enabled: on }))} />
      </SettingRow>

      <div className={card}>
        <label htmlFor="imagine-kie-key" className={heading}>kie.ai API key</label>
        {/* P11-14: a saved key is also in every database backup; with the environment's key in use it's only a leftover. */}
        {savedKie.envKey && savedKie.keySaved && !kie.forgetKey && (
          <div role="alert" className="rounded-lg bg-idle/15 p-3 text-sm text-idle">
            <p>A key ({savedKie.keyHint}) is also saved in the database, and so in its backups. The environment’s key is the one in use, so the saved one can go.</p>
            <button type="button" onClick={() => setKie((k) => ({ ...k, forgetKey: true }))} className="mt-2 rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-500">
              Forget the saved key
            </button>
          </div>
        )}
        {savedKie.envKey ? (
          <p className="text-sm text-gray-400">Using the KIEAI_API_KEY set in the server’s environment.</p>
        ) : (
          <input
            id="imagine-kie-key"
            type="password"
            autoComplete="off"
            value={kieKey}
            onChange={(e) => setKieKey(e.target.value)}
            placeholder={savedKie.keySaved ? `A key is saved (${savedKie.keyHint}) — type to replace it` : 'Paste your kie.ai API key'}
            className="input"
          />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={testKie}
            disabled={!kieKey.trim() && !savedKie.keySaved && !savedKie.envKey}
            className="rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-500 disabled:opacity-60"
          >
            Test key
          </button>
          {!savedKie.envKey && savedKie.keySaved && !kie.forgetKey && (
            <button type="button" onClick={() => setKie((k) => ({ ...k, forgetKey: true }))} className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-ink-600 hover:text-fg">
              Forget the saved key
            </button>
          )}
          {kieNote.text && <span role="status" className={`text-xs ${kieNote.ok ? 'text-online' : 'text-gray-400'}`}>{kieNote.text}</span>}
        </div>
        {kie.forgetKey && <p className="text-xs text-idle">The saved key will be removed when you save.</p>}
        <p className="text-xs text-gray-500">The key stays on the server; it’s never shown again or sent to anyone’s browser.</p>
      </div>

      <div className={card}>
        <div>
          <label htmlFor="imagine-kie-model" className={heading}>kie.ai model</label>
          <select id="imagine-kie-model" value={kie.model} onChange={(e) => setKie((k) => ({ ...k, model: e.target.value }))} className="input">
            <option value="">Pick a model…</option>
            {kieModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === 'custom' ? 'Custom model ID…' : `${m.name} — ${priceLabel(m.price)}`}
              </option>
            ))}
          </select>
          {kieModel && (
            <p className="mt-1 text-xs text-gray-500">
              {kieModel.note} {kieModel.filterable ? 'Content filter on outside 18+ channels.' : ''}
            </p>
          )}
          {kie.model === 'custom' && (
            <input
              aria-label="Custom model ID"
              value={kie.customModel}
              onChange={(e) => setKie((k) => ({ ...k, customModel: e.target.value }))}
              placeholder="vendor/model-name, as kie.ai lists it"
              className="input mt-2"
            />
          )}
        </div>
        {kie.model && (
          // P10-05: what happens to pictures, as its own labelled part.
          <div role="group" aria-labelledby="imagine-kie-pictures" className="space-y-2 border-t border-ink-500/40 pt-3">
            <div id="imagine-kie-pictures" className={heading}>Pictures</div>
            <p className="text-sm text-gray-200" role="note" aria-label="Pictures on kie.ai">
              {picturesBy
                ? `${picturesBy.name} image-to-image · ${picturesBy.picture.strength ? 'Subtle, Medium and Strong' : 'no strength setting, so Variations are one button'}`
                : 'kie.ai won’t take pictures with this model.'}
            </p>
            {needsPictureModel && (
              <div>
                <label htmlFor="imagine-kie-picture-model" className={heading}>Model for pictures</label>
                <select id="imagine-kie-picture-model" value={kie.pictureModel} onChange={(e) => setKie((k) => ({ ...k, pictureModel: e.target.value }))} className="input">
                  <option value="">None (pictures use ComfyUI, if it’s on)</option>
                  {pictureModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <p className="mt-1 text-xs text-gray-500">{kieModel?.id === 'custom' ? 'A custom model' : kieModel?.name} can’t start from a picture, so “Start from a picture” and Variations use this one.</p>
              </div>
            )}
            {picturesBy && (
              <p className="text-xs text-gray-500">For “Start from a picture” and Variations. Each time, DisGourd uploads that one picture to kie.ai’s file storage; kie.ai deletes it after 24 hours.</p>
            )}
          </div>
        )}
      </div>

      <div className={card}>
        <div>
          <label htmlFor="imagine-kie-cap" className={heading}>Monthly credit cap</label>
          <input
            id="imagine-kie-cap"
            type="number"
            min={0}
            value={kie.monthlyCredits}
            onChange={(e) => setKie((k) => ({ ...k, monthlyCredits: e.target.value }))}
            placeholder="No cap"
            className="input w-40"
          />
          <p className="mt-1 text-xs text-gray-500">
            /imagine stops using kie.ai for the rest of the month once this many credits are used. Prices change and new models appear:
            check{' '}
            <a href="https://kie.ai/pricing" target="_blank" rel="noreferrer" className="text-brand-hi underline">kie.ai’s pricing</a> and{' '}
            <a href="https://kie.ai/market" target="_blank" rel="noreferrer" className="text-brand-hi underline">model list</a>. Prices here are the last
            real cost DisGourd saw.
          </p>
        </div>
      </div>
    </div>
  );
}
