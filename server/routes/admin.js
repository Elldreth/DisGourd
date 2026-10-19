// Instance admin: registration management (site admins only).
const crypto = require('crypto');
const db = require('../db');
const { config, registrationMode } = require('../config');
const { authUserId } = require('../auth/tokens');
const { sendJson, readJsonBody } = require('../http/util');
const linkPreviews = require('../linkPreviews');
const imagine = require('../imagine');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // GET/PUT /admin/imagine — the instance's image engines and limits (P2-20)
    match: ({ req, pathSegments }) =>
      pathSegments[0] === 'admin' && pathSegments[1] === 'imagine' && pathSegments.length === 2 && (req.method === 'GET' || req.method === 'PUT'),
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can change this' });
      if (req.method === 'GET') return sendJson(res, 200, imagine.adminView());
      const body = await getJsonBody(req);
      // P3-34: a custom workflow is only saved once every node in it exists
      // on that ComfyUI (asked now, by name).
      const c = body && body.engines && body.engines.comfyui;
      if (c && (c.workflow || c.upscaleWorkflow || c.img2imgWorkflow)) {
        const comfy = imagine.ENGINES.get('comfyui');
        const url = c.url || (imagine.getSettings().engines.comfyui || {}).url;
        for (const [key, kind, label] of [['workflow', 'generate', 'Workflow'], ['upscaleWorkflow', 'upscale', 'Upscale workflow'], ['img2imgWorkflow', 'img2img', 'Image-to-image workflow']]) {
          if (!c[key] || (typeof c[key] === 'string' && !c[key].trim())) continue;
          const checked = comfy.checkWorkflow(c[key], kind);
          if (checked.error) return sendJson(res, 400, { error: `${label}: ${checked.error}` });
          // Unchanged since the last save: no need to ask ComfyUI again.
          const before = (imagine.getSettings().engines.comfyui || {})[key];
          if (before && JSON.stringify(before) === JSON.stringify(checked.workflow)) continue;
          if (!url) return sendJson(res, 400, { error: 'Set the ComfyUI address first, so the workflow can be checked' });
          const missing = await comfy.workflowMissingNodes(comfy.validateConfig({ url }).url || url, checked.classTypes);
          if (missing.length) return sendJson(res, 400, { error: `${label}: your ComfyUI doesn’t have ${missing.length > 1 ? 'these nodes' : 'this node'}: ${missing.join(', ')}` });
        }
      }
      const out = imagine.updateSettings(body);
      return out.error ? sendJson(res, 400, out) : sendJson(res, 200, out);
    },
  },
  {
    // POST /admin/imagine/comfyui/test { url } — the checkpoints a ComfyUI
    // server offers (P2-20b). POST /admin/imagine/try { engine, prompt, shape,
    // quality } — one test image from an engine's saved settings.
    match: ({ req, pathSegments }) =>
      pathSegments[0] === 'admin' && pathSegments[1] === 'imagine' && req.method === 'POST' &&
      (((pathSegments[2] === 'comfyui' || pathSegments[2] === 'kie') && pathSegments[3] === 'test' && pathSegments.length === 4) || (pathSegments[2] === 'try' && pathSegments.length === 3)),
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can change this' });
      const body = await getJsonBody(req);
      if (pathSegments[2] === 'try') {
        const out = await imagine.tryEngine(body, userId);
        return out.error ? sendJson(res, 400, out) : sendJson(res, 200, out);
      }
      // POST /admin/imagine/kie/test { apiKey? } — the key given, or the saved one.
      if (pathSegments[2] === 'kie') {
        const kie = imagine.ENGINES.get('kie');
        const key = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : kie.keyOf(imagine.getSettings().engines.kie || {});
        try {
          return sendJson(res, 200, await kie.testKey(key));
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      const comfy = imagine.ENGINES.get('comfyui');
      const checked = comfy.validateConfig({ url: body.url });
      if (checked.error) return sendJson(res, 400, checked);
      try {
        return sendJson(res, 200, { url: checked.url, ...(await comfy.listAll(checked.url)) });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    },
  },
  {
    // PUT /admin/link-previews { enabled } — turn link previews on/off for the instance
    match: ({ req, pathSegments }) =>
      pathSegments[0] === 'admin' && pathSegments[1] === 'link-previews' && pathSegments.length === 2 && req.method === 'PUT',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can change this' });
      const { enabled } = await getJsonBody(req);
      if (typeof enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled must be true or false' });
      linkPreviews.setEnabled(enabled);
      return sendJson(res, 200, { enabled });
    },
  },
  {
    // ---- Instance admin: registration management (site admins only) ----
    match: ({ pathSegments }) => pathSegments[0] === 'admin' && pathSegments[1] === 'registration',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can manage registration' });

      // GET /admin/registration — current mode, codes, and the admin list
      if (pathSegments.length === 2 && req.method === 'GET') {
        return sendJson(res, 200, {
          mode: registrationMode(),
          maxAccounts: config.maxAccounts,
          envCodeActive: !!config.registrationCode,
          codes: db.listRegCodes(),
          admins: db.listSiteAdmins(),
          linkPreviews: linkPreviews.enabled(),
        });
      }
      // PUT /admin/registration — change the mode
      if (pathSegments.length === 2 && req.method === 'PUT') {
        const { mode } = await getJsonBody(req);
        if (!['open', 'code', 'closed'].includes(mode)) return sendJson(res, 400, { error: 'Invalid mode' });
        db.setSetting('registration_mode', mode);
        return sendJson(res, 200, { mode });
      }
      // POST /admin/registration/codes — mint a code
      if (pathSegments[2] === 'codes' && pathSegments.length === 3 && req.method === 'POST') {
        const body = await getJsonBody(req);
        const maxUses = parseInt(body.maxUses, 10) > 0 ? parseInt(body.maxUses, 10) : null;
        const days = parseInt(body.expiresInDays, 10);
        const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
        const code = crypto.randomBytes(6).toString('base64url');
        db.addRegCode(code, userId, expiresAt, maxUses);
        return sendJson(res, 201, { code });
      }
      // DELETE /admin/registration/codes/:id — revoke a code
      if (pathSegments[2] === 'codes' && pathSegments[3] && req.method === 'DELETE') {
        db.revokeRegCode(parseInt(pathSegments[3], 10));
        return sendJson(res, 200, { ok: true });
      }
      // PUT /admin/registration/admins/:username — promote/demote a site admin
      if (pathSegments[2] === 'admins' && pathSegments[3] && req.method === 'PUT') {
        const { admin } = await getJsonBody(req);
        const target = db.getUserByUsername(pathSegments[3]);
        if (!target) return sendJson(res, 404, { error: 'User not found' });
        if (!admin && db.listSiteAdmins().length <= 1) {
          return sendJson(res, 400, { error: 'There must be at least one site admin' });
        }
        db.setSiteAdmin(target.id, !!admin);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'Not found' });
    },
  },
];

// Returns true when one of these routes handled the request.
async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle };
