import { useImagine, ImagineLoading } from './ImagineSettings.jsx';
import { heading, card } from './constants.js';
import StrengthSlider from './StrengthSlider.jsx';
import SettingRow from '../../settings/SettingRow.jsx';
import Switch from '../../settings/Switch.jsx';

// Image generation › Quality: the hires fix, the Upscale button and the face
// detailer, shared by every style. (Each style's sampler, steps, CFG and
// negative prompt moved to the Styles page in P10-05.)
export default function QualityPage() {
  const s = useImagine();
  if (!s.ready) return <ImagineLoading />;
  const { comfy, setComfy, models, parts, onNavigate } = s;
  const custom = comfy.workflowMode === 'custom';
  const listOr = (list, current) => (list.length ? list : current ? [current] : []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        These apply to ComfyUI, for every style. kie.ai picks its own quality settings. Sampler, steps, CFG and the negative prompt belong to each style
        {onNavigate ? (
          <>
            {' '}(
            <button type="button" onClick={() => onNavigate('imagine-styles')} className="text-brand-hi underline">
              Styles
            </button>
            ).
          </>
        ) : (
          ' (Styles).'
        )}
      </p>

      {/* P10-05: the hires fix and the Upscale button are separate things, so separate cards. */}
      <section className={card} aria-labelledby="imagine-hires-heading">
        <h3 id="imagine-hires-heading" className="sr-only">Hires fix</h3>
        <div>
          <SettingRow
            className="py-0"
            label="Hires fix for High quality"
            description="High-quality images are made at the Standard size, enlarged with the upscale model (SDXL: to 2048 on the long edge on the High memory setting), then repainted for detail. Slower, sharper."
          >
            <Switch label="Hires fix for High quality" checked={comfy.hires} disabled={custom} onChange={(on) => setComfy((c) => ({ ...c, hires: on }))} />
          </SettingRow>
          {comfy.hires && !custom && (
            <div className="mt-3">
              <StrengthSlider
                id="imagine-hires-denoise"
                label="Hires strength"
                value={comfy.hiresDenoise}
                onChange={(v) => setComfy((c) => ({ ...c, hiresDenoise: v }))}
                min={0.1}
                max={0.8}
                defaultValue={0.45}
                low="closer to the original"
                high="more new detail"
                help="How much the hires repaint changes the enlarged image. It uses the upscale model below."
              />
            </div>
          )}
          {custom && <p className="mt-1 text-xs text-gray-500">Not used with your own workflow: it decides this.</p>}
        </div>

      </section>

      <section className={card} aria-labelledby="imagine-upscale-heading">
        <h3 id="imagine-upscale-heading" className="sr-only">Upscale button</h3>
        <div>
          <label htmlFor="imagine-upscaler" className={heading}>Upscale model</label>
          <select id="imagine-upscaler" value={comfy.upscaler} onChange={(e) => setComfy((c) => ({ ...c, upscaler: e.target.value }))} className="input">
            <option value="">Automatic (picked by name)</option>
            {(parts.upscalers.length ? parts.upscalers : comfy.upscaler ? [comfy.upscaler] : []).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-500">Used by the Upscale button and the hires fix.</p>
          {models && !parts.upscalers.length && (
            <p className="mt-1 text-xs text-gray-500">This ComfyUI has no upscale models (models/upscale_models), so there’s no hires fix or Upscale button.</p>
          )}
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
              <div className="col-span-full">
                <StrengthSlider
                  id="imagine-tile-denoise"
                  label="Repaint strength"
                  value={comfy.tileDenoise}
                  onChange={(v) => setComfy((c) => ({ ...c, tileDenoise: v }))}
                  min={0.05}
                  max={0.6}
                  defaultValue={0.2}
                  low="keeps the image"
                  high="more detail, may change faces"
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
      </section>

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
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor="imagine-detector" className={heading}>Face detector</label>
              <select id="imagine-detector" value={comfy.detector} onChange={(e) => setComfy((c) => ({ ...c, detector: e.target.value }))} className="input">
                <option value="">Automatic (picked by name)</option>
                {listOr(parts.detectors, comfy.detector).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="imagine-detailer-passes" className={heading} title="Repeats the repaint inside each face crop; not a loopback of the whole image">Face detailer passes</label>
              <select id="imagine-detailer-passes" value={comfy.detailerPasses} onChange={(e) => setComfy((c) => ({ ...c, detailerPasses: Number(e.target.value) }))} className="input">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="col-span-full">
              <StrengthSlider
                id="imagine-detailer-denoise"
                label="Face repaint strength"
                value={comfy.detailerDenoise}
                onChange={(v) => setComfy((c) => ({ ...c, detailerDenoise: v }))}
                min={0.1}
                max={0.8}
                defaultValue={0.3}
                low="subtle"
                high="strong"
              />
            </div>
            <p className="col-span-full text-xs text-gray-500">
              Passes repeat the repaint inside each face crop, each one starting from the last (it isn’t a loopback of the whole image; that’s Variations). 3 is the default.
            </p>
          </div>
        )}
      </fieldset>

    </div>
  );
}
