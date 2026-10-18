// HTTP route modules, tried in order. Each exports `handle(ctx)`, which
// resolves true if it answered; unmatched requests fall through to the
// web-client / 404 handling in http/handler.js.
const modules = [
  require('./auth'),
  require('./admin'),
  require('./social'),
  require('./spaces'),
  require('./invites'),
  require('./uploads'),
  require('./media'),
  require('./push'),
];

async function dispatch(ctx) {
  for (const m of modules) {
    if (await m.handle(ctx)) return true;
  }
  return false;
}

module.exports = { dispatch };
