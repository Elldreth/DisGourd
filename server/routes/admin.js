// Instance admin: registration management (site admins only).
const db = require('../db');
const { config, registrationMode } = require('../config');
const { authUserId } = require('../auth/tokens');
const { sendJson, readJsonBody } = require('../http/util');
const linkPreviews = require('../linkPreviews');
const imagine = require('../imagine');
const { clientIpVia, proxyTrust } = require('../net/clientIp');
const { newRegCode } = require('../auth/regCodes');
const invitePolicy = require('../auth/invitePolicy');
const { endStaleSessions } = require('../gateway/delivery');
const mail = require('../mail');
const templates = require('../mail/templates');
const { rateLimitOk } = require('../auth/rateLimit');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // Site admin › Email (P12-01): GET /admin/email is the status (never the
    // password); POST /admin/email/test { to? } queues a test email to `to`, or
    // to your own account's address.
    match: ({ pathSegments }) => pathSegments[0] === 'admin' && pathSegments[1] === 'email',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can manage email' });
      const me = db.getUserById(userId);
      if (pathSegments.length === 2 && req.method === 'GET') {
        return sendJson(res, 200, { ...mail.status(), yourAddress: me.email || null, requireConfirmed: db.emailConfirmRequired() });
      }
      // PUT /admin/email { requireConfirmed } (P12-02): only turned on while email works.
      if (pathSegments.length === 2 && req.method === 'PUT') {
        const { requireConfirmed } = await getJsonBody(req);
        if (typeof requireConfirmed !== 'boolean') return sendJson(res, 400, { error: 'requireConfirmed must be true or false' });
        if (requireConfirmed && !mail.enabled()) return sendJson(res, 409, { error: 'Set up email first: nobody could confirm an address while it’s off.' });
        db.setSetting('require_confirmed_email', requireConfirmed ? '1' : '0');
        console.warn(`[admin] ${me.username} turned ${requireConfirmed ? 'on' : 'off'} "Require a confirmed email"`);
        return sendJson(res, 200, { ...mail.status(), yourAddress: me.email || null, requireConfirmed: db.emailConfirmRequired() });
      }
      if (pathSegments[2] === 'test' && pathSegments.length === 3 && req.method === 'POST') {
        const s = mail.settings();
        if (s.missing.length) return sendJson(res, 409, { error: `Email is off. Set ${s.missing.join(', ')} on the server first.` });
        const body = await getJsonBody(req);
        const to = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : me.email;
        if (!mail.looksLikeEmail(to)) return sendJson(res, 400, { error: 'Enter an email address to send the test to' });
        if (!rateLimitOk('mail-test:' + userId, 5, 60 * 60 * 1000)) {
          return sendJson(res, 429, { error: 'That’s 5 test emails this hour. Try again later.' });
        }
        const sent = mail.send({ to, ...templates.testEmail({ serverName: s.serverName, publicUrl: s.publicUrl, by: me.username }) });
        if (!sent.queued) {
          const why = { cap: `Today’s limit of ${s.dailyLimit} emails is reached.`, recipient: 'That address has had 5 emails this hour.', address: 'That isn’t a valid email address.' };
          return sendJson(res, sent.reason === 'address' ? 400 : 429, { error: why[sent.reason] || 'The email wasn’t sent.' });
        }
        console.warn(`[admin] ${me.username} sent a test email`);
        return sendJson(res, 202, { queued: true, to });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    },
  },
  {
    // GET /admin/client-ip (P11-05): the address this server sees for you, and
    // how it got it, for checking a proxy or tunnel setup from a phone.
    match: ({ req, pathSegments }) => pathSegments[0] === 'admin' && pathSegments[1] === 'client-ip' && pathSegments.length === 2 && req.method === 'GET',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can see this' });
      return sendJson(res, 200, { ...clientIpVia(req), trustProxy: proxyTrust.enabled, trustedProxies: process.env.TRUSTED_PROXIES || null, clientIpHeader: proxyTrust.header || null });
    },
  },
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
      // P9-04a: each style's workflows (or the flat fields, for the default style).
      const c = body && body.engines && body.engines.comfyui;
      if (c) {
        const comfy = imagine.ENGINES.get('comfyui');
        const saved = comfy.normalizeConfig(imagine.getSettings().engines.comfyui || {});
        const url = c.url || saved.url;
        const styles = Array.isArray(c.presets)
          ? c.presets.map((p) => ({ name: p && p.name, input: p || {}, before: saved.presets.find((s) => s.id === (p && p.id)) || {} }))
          : [{ name: null, input: c, before: saved.presets.find((s) => s.id === saved.defaultPreset) || {} }];
        for (const s of styles) {
          for (const [key, kind, label] of [['workflow', 'generate', 'Workflow'], ['upscaleWorkflow', 'upscale', 'Upscale workflow'], ['img2imgWorkflow', 'img2img', 'Image-to-image workflow']]) {
            const v = s.input[key];
            if (!v || (typeof v === 'string' && !v.trim())) continue;
            const where = s.name && styles.length > 1 ? `${s.name}: ${label}` : label;
            const checked = comfy.checkWorkflow(v, kind);
            if (checked.error) return sendJson(res, 400, { error: `${where}: ${checked.error}` });
            // Unchanged since the last save: no need to ask ComfyUI again.
            if (s.before[key] && JSON.stringify(s.before[key]) === JSON.stringify(checked.workflow)) continue;
            if (!url) return sendJson(res, 400, { error: 'Set the ComfyUI address first, so the workflow can be checked' });
            const missing = await comfy.workflowMissingNodes(comfy.validateConfig({ url }).url || url, checked.classTypes);
            if (missing.length) return sendJson(res, 400, { error: `${where}: your ComfyUI doesn’t have ${missing.length > 1 ? 'these nodes' : 'this node'}: ${missing.join(', ')}` });
          }
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
          // P14-01: one invite link signs people up too.
          closedAllowsInvites: invitePolicy.closedAllowsInvites(),
          invitesCreateAccounts: invitePolicy.whoCanBringIn(),
        });
      }
      // PUT /admin/registration { mode?, closedAllowsInvites?, invitesCreateAccounts? }
      // mode: open | invite | closed ('code' is the old name for 'invite').
      if (pathSegments.length === 2 && req.method === 'PUT') {
        const body = await getJsonBody(req);
        const mode = body.mode === 'code' ? 'invite' : body.mode;
        if (mode !== undefined && !['open', 'invite', 'closed'].includes(mode)) return sendJson(res, 400, { error: 'Invalid mode' });
        if ('closedAllowsInvites' in body && typeof body.closedAllowsInvites !== 'boolean') return sendJson(res, 400, { error: 'closedAllowsInvites must be true or false' });
        if ('invitesCreateAccounts' in body && !invitePolicy.WHO.includes(body.invitesCreateAccounts)) {
          return sendJson(res, 400, { error: `invitesCreateAccounts is one of ${invitePolicy.WHO.join(', ')}` });
        }
        if (mode !== undefined) db.setSetting('registration_mode', mode);
        if ('closedAllowsInvites' in body) db.setSetting('closed_allows_invites', body.closedAllowsInvites ? '1' : '0');
        if ('invitesCreateAccounts' in body) db.setSetting('invites_create_accounts', body.invitesCreateAccounts);
        return sendJson(res, 200, { mode: registrationMode(), closedAllowsInvites: invitePolicy.closedAllowsInvites(), invitesCreateAccounts: invitePolicy.whoCanBringIn() });
      }
      // POST /admin/registration/codes — mint a code
      if (pathSegments[2] === 'codes' && pathSegments.length === 3 && req.method === 'POST') {
        const body = await getJsonBody(req);
        const maxUses = parseInt(body.maxUses, 10) > 0 ? parseInt(body.maxUses, 10) : null;
        const days = parseInt(body.expiresInDays, 10);
        const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
        const code = newRegCode(); // easy to type on a phone (auth/regCodes.js)
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
  {
    // People (P11-09): GET /admin/users?q= finds accounts; PUT
    // /admin/users/:username { suspended, reason? } suspends or lifts one.
    match: ({ pathSegments }) => pathSegments[0] === 'admin' && pathSegments[1] === 'users' && pathSegments.length <= 3,
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (!db.isSiteAdmin(userId)) return sendJson(res, 403, { error: 'Only site admins can manage people' });
      if (pathSegments.length === 2 && req.method === 'GET') {
        const q = String((parsedUrl.query && parsedUrl.query.q) || '').trim().slice(0, 64);
        return sendJson(res, 200, { users: db.searchUsersForAdmin(q) });
      }
      if (pathSegments.length === 3 && req.method === 'PUT') {
        const { suspended, reason } = await getJsonBody(req);
        if (typeof suspended !== 'boolean') return sendJson(res, 400, { error: 'suspended must be true or false' });
        if (reason != null && (typeof reason !== 'string' || reason.length > 200)) return sendJson(res, 400, { error: 'The reason can be at most 200 characters' });
        const target = db.getUserByUsername(pathSegments[2]);
        if (!target || target.is_bot) return sendJson(res, 404, { error: 'User not found' });
        if (suspended) {
          if (target.id === userId) return sendJson(res, 400, { error: "You can't suspend yourself" });
          if (target.site_admin && !target.suspended_at && db.countActiveSiteAdmins() <= 1) {
            return sendJson(res, 400, { error: 'There must be at least one site admin who can sign in' });
          }
          const version = db.setSuspended(target.id, true, reason ? reason.trim() : null);
          endStaleSessions(target.id, version, 'suspended'); // every socket: none has the new version
        } else {
          db.setSuspended(target.id, false);
        }
        // No instance-wide log yet: the console has it.
        const me = db.getUserById(userId);
        console.warn(`[admin] ${me.username} ${suspended ? 'suspended' : 'lifted the suspension of'} ${target.username}${suspended && reason ? ` (reason: ${String(reason).trim().slice(0, 200)})` : ''}`);
        return sendJson(res, 200, db.adminUserView(db.getUserById(target.id)));
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
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
