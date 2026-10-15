// URL path segments arrive percent-encoded; names in the database are stored
// decoded, so every segment used as a space/channel/user name must be decoded
// before comparison. Falls back to the raw value on malformed input.
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code);
  res.end(JSON.stringify(obj));
}

// An Error carrying the HTTP status the top-level handler should answer with.
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Parse an integer query parameter, falling back to `def` on garbage
// (?limit=abc) and clamping into [min, max] so SQLite never sees NaN.
function intParam(value, def, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Avatar / server-icon framing box: { zoom, cx, cy }. Anything else (huge
// blobs, strings, nested objects) is dropped rather than stored verbatim.
function sanitizeCrop(crop) {
  if (!isPlainObject(crop)) return null;
  const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
  const zoom = num(crop.zoom, 1, 10);
  const cx = num(crop.cx, 0, 1);
  const cy = num(crop.cy, 0, 1);
  if (zoom === null || cx === null || cy === null) return null;
  return { zoom, cx, cy };
}

// Size limits. JSON bodies only ever carry small settings objects; uploads use
// their own streaming path and MAX_UPLOAD_BYTES.
const MAX_JSON_BYTES = 64 * 1024;
const MAX_WS_PAYLOAD_BYTES = 256 * 1024; // generous for WebRTC SDP offers

// Read and parse a JSON request body. Rejects with a 400 for malformed JSON or
// a non-object payload (`null`, `5`, `[]`) so handlers can destructure safely,
// and with a 413 once the body passes MAX_JSON_BYTES.
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return; // keep draining, but stop buffering
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        tooLarge = true;
        body = '';
        reject(httpError(413, 'Request body is too large'));
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (tooLarge) return;
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        return reject(httpError(400, 'Invalid JSON'));
      }
      if (!isPlainObject(parsed)) return reject(httpError(400, 'JSON body must be an object'));
      resolve(parsed);
    });
    request.on('error', (err) => reject(httpError(400, err.message)));
  });
}

module.exports = {
  safeDecode, sendJson, httpError, intParam, isPlainObject, sanitizeCrop, readJsonBody,
  MAX_JSON_BYTES, MAX_WS_PAYLOAD_BYTES,
};
