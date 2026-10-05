#!/usr/bin/env bash
# Release roundtrip: build -> push -> purge local tags -> pull -> up --no-build.
#
# Proves that a user can run the stack without ever building: every first-party
# image is fetched from a registry. Uses a throwaway local registry and a `test`
# tag so nothing collides with released tags or with the dev stack; a generated
# compose override points the images there (see below).
#
# Usage: scripts/e2e/release-roundtrip.sh   (from the repo root)
set -euo pipefail

REGISTRY=localhost:5000
REGISTRY_CONTAINER=stac-release-registry
TAG=test
PROJECT=stac-release-test
# Port 8001 keeps the test clear of the dev stack on 8000.
export STACK_VERSION=$TAG
export COMPOSE_PROJECT_NAME=$PROJECT
export HTTP_PORT=8001

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"

# Path of the compose override that redirects the images to the throwaway
# registry; generated after the initial cleanup below, which must run first or
# it would delete the override before the build.
OVERRIDE=""

step() { printf '\n== %s\n' "$*"; }
cleanup() {
  printf '\n== cleanup\n'
  docker compose --profile tls down -v --remove-orphans >/dev/null 2>&1 || true
  for i in "${IMAGES[@]}"; do docker rmi -f "$i" >/dev/null 2>&1 || true; done
  docker rm -f "$REGISTRY_CONTAINER" >/dev/null 2>&1 || true
  [ -n "$OVERRIDE" ] && rm -f "$OVERRIDE" || true
  echo "   stack down, images purged, registry removed"
}

trap cleanup EXIT
cleanup   # a previous failed run may have left state behind

# docker-compose.yml hardcodes the production registry, so pushing or pulling
# its image names as-is would publish a `test` tag into the real ghcr.io
# namespace. Redirect every buildable service to the throwaway registry through
# a generated compose override — generated from compose's own output rather than
# retyped, so the naming scheme stays in docker-compose.yml and cannot drift.
OVERRIDE=$(mktemp)
docker compose -f "$REPO_ROOT/docker-compose.yml" config --format json | python3 -c '
import json, sys
reg, tag = sys.argv[1], sys.argv[2]
svc = json.load(sys.stdin)["services"]
built = {n: s["image"] for n, s in sorted(svc.items()) if s.get("build")}
if not built:
    sys.exit("compose exposes no buildable services")
print("services:")
for name, image in built.items():
    base = image.rsplit("/", 1)[-1].split(":")[0]
    print("  %s:" % name)
    print("    image: %s/%s:%s" % (reg, base, tag))
' "$REGISTRY" "$TAG" > "$OVERRIDE"
export COMPOSE_FILE="$REPO_ROOT/docker-compose.yml:$OVERRIDE"

SERVICES=()
IMAGES=()
# Compose remains the single source of truth for both service and image names,
# resolved through the override so they point at the throwaway registry.
eval "$(docker compose config --format json | python3 -c '
import json, sys
svc = json.load(sys.stdin)["services"]
built = [(n, s["image"]) for n, s in sorted(svc.items()) if s.get("build")]
if not built:
    sys.exit("compose exposes no buildable services")
print("SERVICES=(%s)" % " ".join(n for n, _ in built))
print("IMAGES=(%s)" % " ".join(i for _, i in built))
')"
[ "${#IMAGES[@]}" -gt 0 ] || { echo "no first-party image resolved"; exit 1; }
printf '   %d images: %s\n' "${#IMAGES[@]}" "${SERVICES[*]}"

step "1/6 start local registry at $REGISTRY"
docker rm -f "$REGISTRY_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$REGISTRY_CONTAINER" -p 5000:5000 registry:2 >/dev/null
for _ in $(seq 30); do
  curl -sf "http://$REGISTRY/v2/" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://$REGISTRY/v2/" >/dev/null || { echo "registry did not come up"; exit 1; }
echo "   up"

step "2/6 build + push ${#IMAGES[@]} images as :$TAG"
docker compose build --progress=plain "${SERVICES[@]}" 2>&1 | grep -E '^\#[0-9]+ (DONE|CACHED)' | tail -3 || true
for i in "${IMAGES[@]}"; do
  printf '   push %s\n' "$i"
  docker push -q "$i" >/dev/null
done

step "3/6 verify the registry really holds them"
for i in "${IMAGES[@]}"; do
  repo="${i%:*}"
  curl -sf "http://$REGISTRY/v2/${repo#${REGISTRY}/}/tags/list" >/dev/null \
    || { echo "missing in registry: $i"; exit 1; }
done
echo "   all ${#IMAGES[@]} present"

step "4/6 purge local tags, so any later run MUST pull"
for i in "${IMAGES[@]}"; do docker rmi -f "$i" >/dev/null; done
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q ":${TAG}$"; then
  echo "local :$TAG tags still present — purge failed"; exit 1
fi
echo "   local :$TAG tags gone"

step "5/6 pull from the registry, then up with --no-build"
docker compose pull --quiet
for i in "${IMAGES[@]}"; do
  docker image inspect "$i" >/dev/null 2>&1 || { echo "pull failed: $i"; exit 1; }
done
echo "   all ${#IMAGES[@]} pulled"
# No `--wait` here: zarr-viewer and notebook-viewer are one-shot init services
# that exit 0 on purpose, which compose reports as a --wait failure.
docker compose up -d --no-build
docker compose wait zarr-viewer notebook-viewer || true
# browser is recreated once the one-shots have filled the shared volumes.
docker compose up -d --no-build --force-recreate browser

base="http://127.0.0.1:${HTTP_PORT}"
# nginx answers 502 until the browser upstream is accepting: poll, don't race it.
for _ in $(seq 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$base/" || echo 000)" = 200 ] && break
  sleep 2
done

step "6/6 smoke test"
fail=0
check() {
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base$1" || echo 000)
  [ "$code" = "$2" ] && printf '   %-28s %s\n' "$1" "$code" || { printf '   %-28s %s (attendu %s)\n' "$1" "$code" "$2"; fail=1; }
}
check / 200
check /api/ 200
check /viewer/ 200
check /notebook-viewer/ 200
check /data/ 200
if [ "$fail" -ne 0 ]; then
  echo "--- état des services ---"; docker compose ps -a
  for s in nginx browser static-api; do
    echo "--- logs $s ---"; docker compose logs --tail=25 "$s" 2>&1
  done
  exit 1
fi
echo "   stack served from registry tags"

echo
echo "ROUNDTRIP OK"