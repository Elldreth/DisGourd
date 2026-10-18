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
      const out = imagine.updateSettings(await getJsonBody(req));
      return out.error ? sendJson(res, 400, out) : sendJson(res, 200, out);
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
