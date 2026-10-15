// HTTP route modules, tried in order before the remaining inline routes in
// server.js. Each exports `handle(ctx)`, which resolves true if it answered.
const modules = [require('./auth'), require('./admin'), require('./social')];

async function dispatch(ctx) {
  for (const m of modules) {
    if (await m.handle(ctx)) return true;
  }
  return false;
}

module.exports = { dispatch };
