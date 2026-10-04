#!/usr/bin/env bash
# Re-resolves every base-image digest pin against its registry and rewrites it.
#
# Why: a digest pin freezes the base image, so it also freezes its OS security
# patches. Re-pinning is the only reproducible way to pick them up — an
# `apt-get upgrade` in a Dockerfile changes the built content on every rebuild.
#
#   scripts/repin-digests.sh            rewrite stale pins
#   scripts/repin-digests.sh --check    report drift only, write nothing (CI gate)
#
# Only the DIGEST moves. The tag stays the one already declared, except when a
# Dockerfile passes the digest through an ARG (`ARG PYTHON_DIGEST=@sha256:…` +
# `FROM python:${PYTHON_VERSION}-alpine${PYTHON_DIGEST}`), where the tag is read
# back from that FROM line with the other ARG defaults expanded. Bumping a
# version tag is a deliberate act, not this script's job.
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# Emits "<file>\t<old-digest-hex>\t<image:tag to pull>" per pin, digest hex only.
pins() {
	grep -rlE '@sha256:[0-9a-f]{64}' --include='Dockerfile*' --include='*.yml' . \
		| grep -v node_modules | sort | while read -r f; do
		awk -v file="${f#./}" '
			{ line[NR] = $0
			  if (match($0, /^ARG[ ]+[A-Za-z_][A-Za-z0-9_]*=/)) {
				split($0, a, "=")
				gsub(/[ \t]/, "", a[1]); sub(/^ARG/, "", a[1])
				defarg[a[1]] = a[2]
			  }
			}
			function hex(s) { sub(/^.*@sha256:/, "", s); sub(/[^0-9a-f].*$/, "", s); return s }
			function expand(s,   i, out, name) {
				while (match(s, /\$\{[A-Za-z_][A-Za-z0-9_]*\}/)) {
					name = substr(s, RSTART + 2, RLENGTH - 3)
					out = (name in defarg) ? defarg[name] : ""
					s = substr(s, 1, RSTART - 1) out substr(s, RSTART + RLENGTH)
				}
				return s
			}
			END {
				for (i = 1; i <= NR; i++) {
					l = line[i]
					# BuildKit frontend: # syntax=docker/dockerfile:1.7@sha256:…
					if (match(l, /^#[ ]*syntax=/)) {
						ref = l; sub(/^#[ ]*syntax=/, "", ref); sub(/@.*$/, "", ref)
						printf "%s\t%s\t%s\n", file, hex(l), ref
						continue
					}
					# FROM x@sha256:…  /  COPY --from=x@sha256:…  /  image: x@sha256:…
					if (match(l, /^(FROM|COPY --from=)[ ]+[A-Za-z0-9._\/-]+(:[A-Za-z0-9._-]+)?@sha256:/)) {
						ref = l; sub(/^(FROM|COPY --from=)[ ]+/, "", ref); sub(/@.*$/, "", ref)
						printf "%s\t%s\t%s\n", file, hex(l), ref
						continue
					}
					if (match(l, /^[ ]*image:[ ]+[A-Za-z0-9._\/-]+(:[A-Za-z0-9._-]+)?@sha256:/)) {
						ref = l; sub(/^[ ]*image:[ ]+/, "", ref); sub(/@.*$/, "", ref)
						printf "%s\t%s\t%s\n", file, hex(l), ref
						continue
					}
					# ARG PYTHON_DIGEST=@sha256:… → resolve via the FROM using it
					if (match(l, /^ARG[ ]+[A-Za-z_][A-Za-z0-9_]*=@sha256:/)) {
						split(l, a, "="); name = a[1]; sub(/^ARG[ ]+/, "", name)
						ref = ""
						for (j = 1; j <= NR; j++) {
							if (match(line[j], /^FROM[ ]+/) && index(line[j], "${" name "}")) {
								ref = expand(line[j])
								sub(/^FROM[ ]+/, "", ref); sub(/\$\{.*/, "", ref); sub(/[ \t].*$/, "", ref); sub(/@.*$/, "", ref)
								break
							}
						}
						if (ref != "") printf "%s\t%s\t%s\n", file, hex(l), ref
						else printf "%s\t%s\t!!cannot resolve ${%s}\n", file, hex(l), name
					}
				}
			}
		' "$f"
	done
}

digest_of() { # prints the sha256 hex of the given image:tag
	docker pull -q "$1" >/dev/null 2>&1 || return 1
	docker inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null | sed -E 's/.*@sha256://'
}

changed=0
declare -A seen
while IFS=$'\t' read -r file old ref; do
	case "$ref" in
	!!*)
		echo "SKIP  $file — $ref"
		echo "      (digest left untouched)"
		continue
		;;
	esac
	if [ -n "${seen[$ref]:-}" ]; then
		new="${seen[$ref]}"
	else
		new="$(digest_of "$ref")" || { echo "FAIL  $ref (pull failed)"; continue; }
		seen[$ref]="$new"
	fi
	if [ "$new" = "$old" ]; then
		printf 'OK       %-42s %s…\n' "$ref" "${old:0:12}"
		continue
	fi
	changed=$((changed + 1))
	printf 'BUMP     %-42s %s… -> %s…\n' "$ref" "${old:0:12}" "${new:0:12}"
	[ "$CHECK_ONLY" = "1" ] && continue
	occurrences="$(grep -c "$old" "$file" || true)"
	sed -i "s|$old|$new|g" "$file"
	printf '         %s (%s occurrence(s))\n' "$file" "$occurrences"
done < <(pins)

echo
if [ "$changed" = "0" ]; then
	echo "All base-image digests are current."
else
	echo "$changed base image(s) re-pinned. Rebuild, then re-scan: make build && make trivy"
	[ "$CHECK_ONLY" = "1" ] && echo "(--check: nothing written)"
fi