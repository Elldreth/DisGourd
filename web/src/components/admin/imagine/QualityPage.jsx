import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { TYPE_DEFAULTS, QUALITY_NAMES, heading, card } from './constants.js';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';

// Image generation › Quality: upscaling, the hires fix, the face detailer and
// (folded away) the sampler, scheduler, CFG, steps and negative prompt.
export default function QualityPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy, models, parts, styles, editingStyle, styleActions } = s;
  const custom = comfy.workflowMode === 'custom';
  const d = TYPE_DEFAULTS[comfy.family] || TYPE_DEFAULTS.sdxl;
  const listOr = (list, current) => (list.length ? list : current ? [current] : []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">These apply to ComfyUI. kie.ai picks its own quality settings.</p>

      <div className={card}>
        <div>
          <label htmlFor="imagine-upscaler" className={heading}>Upscale model</label>
          <select id="imagine-upscaler" value={comfy.upscaler} onChange={(e) => setComfy((c) => ({ ...c, upscaler: e.target.value }))} className="input">
            <option value="">Automatic (picked by name)</option>
            {(parts.upscalers.length ? parts.upscalers : comfy.upscaler ? [comfy.upscaler] : []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">Used by the hires fix and the Upscale button.</p>
          {models && !parts.upscalers.length && (
            <p className="mt-1 text-xs text-gray-500">This ComfyUI has no upscale models (models/upscale_models), so there’s no hires fix or Upscale button.</p>
          )}
        </div>

        <div>
          <SettingRow
            className="py-0"
            label="Hires fix for High quality"
            description="High-quality images are made at the Standard size, enlarged with the upscale model (SDXL: to 2048 on the long edge on the High memory setting), then repainted for detail. Slower, sharper."
          >
            <Switch label="Hires fix for High quality" checked={comfy.hires} disabled={custom} onChange={(on) => setComfy((c) => ({ ...c, hires: on }))} />
          </SettingRow>
          {comfy.hires && !custom && (
            <div className="mt-2">
              <label htmlFor="imagine-hires-denoise" className={heading}>Hires strength</label>
              <input id="imagine-hires-denoise" type="number" min="0.1" max="0.8" step="0.05" value={comfy.hiresDenoise}
                onChange={(e) => setComfy((c) => ({ ...c, hiresDenoise: e.target.value }))} className="input w-32" />
              <p className="mt-1 text-xs text-gray-500">How much the hires repaint changes the enlarged image. 0.45 adds detail; lower keeps it closer.</p>
            </div>
          )}
          {custom && <p className="mt-1 text-xs text-gray-500">Not used with your own workflow: it decides this.</p>}
        </div>

        <fieldset disabled={custom && !!comfy.upscaleWorkflow.trim()}>
          <legend className={`${heading} float-left w-full`}>Upscale button (2×, up to 4096 px)</legend>
          {custom && comfy.upscaleWorkflow.trim() && (
            <p className="clear-both mb-1 text-xs text-gray-500">Your upscale workflow is used instead of these.</p>
          )}
          <div className="clear-both space-y-1.5">
            <label className="flex items-start gap-2 text-sm text-gray-200">
              <input type="radio" name="imagine-upscale-mode" checked={comfy.upscaleMode !== 'tiled'} onChange={() => setComfy((c) => ({ ...c, upscaleMode: 'model' }))} className="mt-1 accent-brand" />
              <span>
                Upscale model only
                <span className="block text-xs text-gray-500">fast, nothing to tune</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${parts.tiledAvailable === false ? 'text-gray-500' : 'text-gray-200'}`}>
              <input
                type="radio"
                name="imagine-upscale-mode"
                checked={comfy.upscaleMode === 'tiled'}
                disabled={parts.tiledAvailable === false && comfy.upscaleMode !== 'tiled'}
                onChange={() => setComfy((c) => ({ ...c, upscaleMode: 'tiled' }))}
                className="mt-1 accent-brand"
              />
              <span>
                Tiled repaint
                <span className="block text-xs text-gray-500">adds detail; may need tuning</span>
              </span>
            </label>
          </div>
          {parts.tiledAvailable === false && (
            <p className="mt-1 text-xs text-gray-500">
              Tiled repaint needs the <strong>ComfyUI_UltimateSDUpscale</strong> custom node (by ssitu), which ComfyUI Manager can install.
            </p>
          )}
          {parts.tiledAvailable === false && comfy.upscaleMode === 'tiled' && (
            <p role="alert" className="mt-1 rounded-md bg-idle/15 px-2 py-1 text-xs text-idle">
              Tiled repaint is chosen, but this ComfyUI doesn’t have it, so the Upscale button uses the upscale model only.
            </p>
          )}
          {comfy.upscaleMode === 'tiled' && (
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="imagine-tile-denoise" className={heading}>Repaint strength</label>
                <input
                  id="imagine-tile-denoise"
                  type="number"
                  min="0.05"
                  max="0.6"
                  step="0.05"
                  value={comfy.tileDenoise}
                  onChange={(e) => setComfy((c) => ({ ...c, tileDenoise: e.target.value }))}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="imagine-tile-size" className={heading}>Tile size</label>
                <select id="imagine-tile-size" value={comfy.tileSize} onChange={(e) => setComfy((c) => ({ ...c, tileSize: Number(e.target.value) }))} className="input">
                  {[512, 768, 1024, 1280, 1536, 2048].map((n) => <option key={n} value={n}>{n} px</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="imagine-tile-passes" className={heading}>Tiled passes</label>
                <select id="imagine-tile-passes" value={comfy.tilePasses} disabled={parts.tiledPassesAvailable === false}
                  onChange={(e) => setComfy((c) => ({ ...c, tilePasses: Number(e.target.value) }))} className="input">
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <p className="col-span-full text-xs text-gray-500">
                Lower strength keeps the image as it is; higher adds detail but can change faces or repeat things across tiles (0.2–0.35 is usual). Bigger tiles need more VRAM. Each extra pass repaints the enlarged image again and takes about as long as the first.
              </p>
            </div>
          )}
        </fieldset>
      </div>

      <fieldset className={card} disabled={parts.detailerAvailable === false && !comfy.detailer}>
        <legend className="sr-only">Face detailer</legend>
        <SettingRow className="py-0" label="Face detailer on Standard and High" description="Finds faces and repaints them at a better size. Adds a few seconds to images with faces.">
          <Switch label="Face detailer on Standard and High" checked={comfy.detailer} onChange={(on) => setComfy((c) => ({ ...c, detailer: on }))} />
        </SettingRow>
        {parts.detailerAvailable === false && (
          <p className="text-xs text-gray-500">
            Needs the <strong>ComfyUI-Impact-Pack</strong> and <strong>ComfyUI-Impact-Subpack</strong> custom nodes (by ltdrdata; ComfyUI Manager can install
            both), plus a face detector model such as face_yolov8m.pt in models/ultralytics/bbox.
          </p>
        )}
        {parts.detailerAvailable === false && comfy.detailer && (
          <p role="alert" className="rounded-md bg-idle/15 px-2 py-1 text-xs text-idle">
            The face detailer is on, but this ComfyUI doesn’t have it, so images are made without it.
          </p>
        )}
        {comfy.detailer && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="imagine-detector" className={heading}>Face detector</label>
              <select id="imagine-detector" value={comfy.detector} onChange={(e) => setComfy((c) => ({ ...c, detector: e.target.value }))} className="input">
                <option value="">Automatic (picked by name)</option>
                {listOr(parts.detectors, comfy.detector).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="imagine-detailer-denoise" className={heading}>Face repaint strength</label>
              <input id="imagine-detailer-denoise" type="number" min="0.1" max="0.8" step="0.05" value={comfy.detailerDenoise}
                onChange={(e) => setComfy((c) => ({ ...c, detailerDenoise: e.target.value }))} className="input" />
            </div>
            <div>
              <label htmlFor="imagine-detailer-passes" className={heading} title="Repeats the repaint inside each face crop; not a loopback of the whole image">Face detailer passes</label>
              <select id="imagine-detailer-passes" value={comfy.detailerPasses} onChange={(e) => setComfy((c) => ({ ...c, detailerPasses: Number(e.target.value) }))} className="input">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <p className="col-span-full text-xs text-gray-500">
              Passes repeat the repaint inside each face crop, each one starting from the last (it isn’t a loopback of the whole image; that’s Variations). 3 is the default.
            </p>
          </div>
        )}
      </fieldset>

      <details className="rounded-xl bg-ink-900/60 px-4 py-3" aria-label="Advanced settings">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-200">Advanced</summary>
        <div className="mt-3 space-y-3">
          {styles.length > 1 ? (
            <div>
              <label htmlFor="imagine-advanced-style" className={heading}>Style</label>
              <select id="imagine-advanced-style" value={editingStyle.id} onChange={(e) => styleActions.edit(e.target.value)} className="input sm:w-64">
                {styles.map((st) => <option key={st.id} value={st.id}>{st.name.trim() || 'Untitled'}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Each style has its own Advanced settings. Blank uses the model type’s tuned default.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-500">For every /imagine on this instance. Blank uses the model type’s tuned default.</p>
          )}
          {custom && (
            <p className="rounded-md bg-ink-800 px-2 py-1 text-xs text-gray-400">
              With your own workflow, only Steps and the Negative prompt are used (through {'{{steps}}'} and {'{{negative}}'}); the rest is up to the workflow.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="imagine-sampler" className={heading}>Sampler</label>
              <select id="imagine-sampler" value={comfy.sampler} onChange={(e) => setComfy((c) => ({ ...c, sampler: e.target.value }))} className="input">
                <option value="">Default ({d.sampler})</option>
                {listOr(parts.samplers, comfy.sampler).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="imagine-scheduler" className={heading}>Scheduler</label>
              <select id="imagine-scheduler" value={comfy.scheduler} onChange={(e) => setComfy((c) => ({ ...c, scheduler: e.target.value }))} className="input">
                <option value="">Default ({d.scheduler})</option>
                {listOr(parts.schedulers, comfy.scheduler).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="imagine-cfg" className={heading}>CFG</label>
              <input id="imagine-cfg" type="number" min="0" max="30" step="0.5" value={comfy.cfgScale} placeholder={`Default (${d.cfg})`}
                onChange={(e) => setComfy((c) => ({ ...c, cfgScale: e.target.value }))} className="input" />
            </div>
          </div>
          <fieldset>
            <legend className={heading}>Steps</legend>
            <div className="grid grid-cols-3 gap-3">
              {['draft', 'standard', 'high'].map((q) => (
                <div key={q}>
                  <label htmlFor={`imagine-steps-${q}`} className="mb-1 block text-xs text-gray-400">{QUALITY_NAMES[q]}</label>
                  <input id={`imagine-steps-${q}`} type="number" min="1" max="150" step="1" value={comfy.steps[q]} placeholder={`Default (${d.steps[q]})`}
                    onChange={(e) => setComfy((c) => ({ ...c, steps: { ...c.steps, [q]: e.target.value } }))} className="input" />
                </div>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="imagine-hires-steps" className={heading}>Hires steps</label>
              <input id="imagine-hires-steps" type="number" min="1" max="150" step="1" value={comfy.hiresSteps} placeholder={`Default (${d.hiresSteps})`}
                onChange={(e) => setComfy((c) => ({ ...c, hiresSteps: e.target.value }))} className="input" />
            </div>
            {comfy.kind !== 'unet' && (comfy.family === 'sdxl' || comfy.family === 'sd15') && (
              <div>
                <label htmlFor="imagine-clip-skip" className={heading}>CLIP skip</label>
                <select id="imagine-clip-skip" value={comfy.clipSkip} onChange={(e) => setComfy((c) => ({ ...c, clipSkip: e.target.value }))} className="input">
                  <option value="">Default ({d.clipSkip})</option>
                  <option value="1">1 (off)</option>
                  <option value="2">2</option>
                </select>
              </div>
            )}
          </div>
          <div>
            <label htmlFor="imagine-negative" className={heading}>Negative prompt</label>
            <textarea id="imagine-negative" rows={2} maxLength={1000} value={comfy.negative} placeholder="Default (lowres, worst quality, blurry, watermark…)"
              onChange={(e) => setComfy((c) => ({ ...c, negative: e.target.value }))} className="input" />
            <p className="mt-1 text-xs text-gray-500">Replaces the built-in one. Outside 18+ channels the safety words are still added for SD 1.5 / SDXL. Flux and Z-Image mostly ignore it.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
