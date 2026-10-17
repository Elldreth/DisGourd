#!/usr/bin/env bash
# Docker smoke test (run by CI after building the image). It runs the image the
# way Unraid does: as 99:100, with host folders mounted on /config and /uploads.
# It checks that the container becomes healthy and doesn't run as root, that
# data survives a restart, and that a root-owned volume fails with a clear
# message, then works after a chown.
#   usage: deploy/docker-smoke.sh [image]   (needs docker, curl, jq, sudo)
set -euo pipefail

IMAGE="${1:-disgourd:ci}"
NAME=disgourd-smoke
PORT=3999
WORK="$(mktemp -d)"
SECRET="$(openssl rand -hex 32)"

cleanup() {
  docker rm -f "$NAME" "$NAME-root" >/dev/null 2>&1 || true
  sudo rm -rf "$WORK"
}
trap cleanup EXIT

step() { echo; echo "== $*"; }
fail() { echo "FAIL: $*"; docker logs "$NAME" 2>&1 | tail -40 || true; exit 1; }

start() { # name, config dir, uploads dir, port
  docker run -d --name "$1" --user 99:100 \
    -e JWT_SECRET="$SECRET" -e REGISTRATION_MODE=open \
    -v "$2:/config" -v "$3:/uploads" -p "$4:3000" "$IMAGE" >/dev/null
}
wait_healthy() { # name
  for i in $(seq 1 75); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null || echo missing)"
    if [ "$status" = healthy ]; then echo "healthy after ${i}s"; return 0; fi
    sleep 1
  done
  return 1
}

step "fresh volumes owned by 99:100"
mkdir -p "$WORK/config" "$WORK/uploads"
sudo chown -R 99:100 "$WORK/config" "$WORK/uploads"
start "$NAME" "$WORK/config" "$WORK/uploads" "$PORT"
wait_healthy "$NAME" || fail "not healthy within 75s (HEALTHCHECK interval is 30s)"

step "not running as root"
uid="$(docker exec "$NAME" id -u)"
gid="$(docker exec "$NAME" id -g)"
echo "uid=$uid gid=$gid"
[ "$uid" = 99 ] && [ "$gid" = 100 ] || fail "expected 99:100, got $uid:$gid"

step "register, upload, restart: data persists"
base="http://localhost:$PORT"
token="$(curl -fsS -X POST "$base/register" -H 'content-type: application/json' \
  -d '{"username":"smoke","password":"smoke-pass-123","email":"smoke@example.test"}' | jq -r .token)"
[ -n "$token" ] && [ "$token" != null ] || fail "register gave no token"
url="$(curl -fsS -X POST "$base/uploads?name=hello.txt" -H "Authorization: Bearer $token" \
  --data-binary 'hello from the smoke test' | jq -r .url)"
[ -n "$url" ] && [ "$url" != null ] || fail "upload gave no url"
echo "uploaded $url"
docker restart "$NAME" >/dev/null
wait_healthy "$NAME" || fail "not healthy after restart"
curl -fsS -X POST "$base/login" -H 'content-type: application/json' \
  -d '{"username":"smoke","password":"smoke-pass-123"}' | jq -e .token >/dev/null || fail "login failed after restart"
[ "$(curl -fsS "$base$url")" = 'hello from the smoke test' ] || fail "upload missing after restart"
owner="$(sudo stat -c '%u:%g' "$WORK/config/disgourd.db")"
echo "database file on the host is owned by $owner"
[ "$owner" = 99:100 ] || fail "database file owned by $owner, expected 99:100"
docker rm -f "$NAME" >/dev/null

step "an old root-owned volume: clear message, then fixed by chown"
mkdir -p "$WORK/oldconfig" "$WORK/olduploads"
sudo chown -R 0:0 "$WORK/oldconfig" "$WORK/olduploads"
sudo chmod 755 "$WORK/oldconfig" "$WORK/olduploads"
start "$NAME-root" "$WORK/oldconfig" "$WORK/olduploads" $((PORT + 1))
code="$(timeout 30 docker wait "$NAME-root" || echo timeout)"
logs="$(docker logs "$NAME-root" 2>&1)"
echo "$logs"
[ "$code" = 1 ] || fail "expected exit code 1, got $code"
grep -q "can't write to its data folders (running as 99:100)" <<<"$logs" || fail "no clear message in the logs"
grep -q 'EACCES' <<<"$logs" || fail "the message doesn't name the error"
docker rm -f "$NAME-root" >/dev/null
sudo chown -R 99:100 "$WORK/oldconfig" "$WORK/olduploads" # the README's one-time fix
start "$NAME-root" "$WORK/oldconfig" "$WORK/olduploads" $((PORT + 1))
wait_healthy "$NAME-root" || fail "still not healthy after the chown"

echo
echo "Docker smoke test passed."
