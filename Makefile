# STAC-OIE — orchestration Docker et tests E2E déploiement
#
# TLS is handled by an external reverse proxy: the stack itself is HTTP-only.
#
# Tests :
#   make test          — HTTP direct (:/TEST_DIRECT_PORT) + WebDAV /data
#   make test-direct   — http://localhost:TEST_DIRECT_PORT
#   make test-webdav   — WebDAV /data (lecture publique, écriture admin)

.PHONY: build rebuild up up-tls tls down dev dev-up sync sync-dry sync-code deploy deploy-check test test-direct test-webdav e2e-clean rebuild-viewer submodules trivy trivy-repo trivy-clean

RSYNC_EXCLUDES := --exclude volumes/ --exclude .env --exclude .ssh/ --exclude-from .rsyncignore

COMPOSE := docker compose
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

# Published version. On a released checkout the tag is the record; VERSION is the
# committed fallback for an untagged clone (main, just after a release). Tag
# first, like `version_of` in scripts/release.sh: a tag is written after the
# VERSION bump commit, so a clone sitting on the tag would otherwise read the
# *previous* version out of VERSION and silently pull its images. .env is
# deliberately not a source here: it holds host secrets.
STACK_VERSION := $(shell git describe --tags --exact-match 2>/dev/null || cat VERSION 2>/dev/null || echo latest)
export STACK_VERSION

TEST_DIRECT_PORT ?= 18001
TEST_BACKEND_PORT ?= 18002

export TEST_DIRECT_PORT TEST_BACKEND_PORT

env ?= prod

ifeq ($(env),dev)
  DEPLOY_HOST := demos
  DEPLOY_PATH := ~/stac
else ifeq ($(env),prod)
  DEPLOY_HOST := stac
  DEPLOY_PATH := ~/stac
else
  $(error Unknown env=$(env), expected dev or prod)
endif

DEPLOY_DEST := $(DEPLOY_HOST):$(DEPLOY_PATH)/


submodules:
	@test -f services/zarr-viewer/package.json || (echo "Run: git submodule update --init --recursive" && exit 1)
	@test -f services/stac-generator/pyproject.toml || (echo "Run: git submodule update --init --recursive" && exit 1)
	@test -f services/zarr-subset-zip/pyproject.toml || (echo "Run: git submodule update --init --recursive" && exit 1)
# BuildKit skips services whose build context did not change, so a plain
# `make build` only rebuilds what you touched. Running containers are left
# alone (no needless down/up); use SERVICE to force a subset, e.g.
#   make build SERVICE="browser"
build: submodules
	$(COMPOSE) build $(SERVICE)

# Full rebuild that also stops the stack first.
rebuild: submodules
	$(COMPOSE) down
	$(COMPOSE) build

rebuild-viewer: submodules
	$(COMPOSE) build zarr-viewer
	$(COMPOSE) run --rm zarr-viewer
	$(COMPOSE) up -d --force-recreate browser

up:
	$(COMPOSE) up

# Adds the optional Caddy TLS terminator (:80/:443) and pins nginx to loopback, so
# Caddy becomes the only reachable entry point. Compose cannot make `ports`
# conditional on a profile, hence BIND_ADDR here (the shell wins over .env).
# Requires DOMAIN in .env to resolve to this host and both ports to be free.
up-tls tls:
	BIND_ADDR=127.0.0.1 $(COMPOSE) --profile tls up -d

.dev-up dev:
	$(COMPOSE_DEV) up

dev-up: dev

down:
	$(COMPOSE) down

sync-dry:
	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
	rsync -anvh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)';
	rsync -anvh --exclude .env ./volumes/data/ '$(DEPLOY_DEST)volumes/data/';

#sync:
#	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
#   rsync -avh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)';
# 	rsync -avh --exclude .env ./volumes/data/ '$(DEPLOY_DEST)volumes/data/';


sync-code:
	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
	rsync -avh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)'

# Sync sources then rebuild/restart the remote stack over SSH.
#   make deploy            → prod (host $(DEPLOY_HOST))
#   make deploy env=dev    → dev host
deploy: sync-code
	@echo "Remote $(DEPLOY_HOST): down / build / up"
	@# ssh does not forward this shell's environment, so STACK_VERSION has to be
	@# exported explicitly in the remote command. Without it compose falls back to
	@# its "${STACK_VERSION:-dev}" default and the footer reads "dev".
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && export STACK_VERSION=$(STACK_VERSION) && docker compose down && docker compose build && docker compose up -d'

# Prod (stac) runs inside systemd-nspawn; Docker needs session keyrings (keyctl).
deploy-check:
	@echo "Checking Docker runtime on $(DEPLOY_HOST)..."
	@ssh $(DEPLOY_HOST) 'docker run --rm hello-world >/dev/null' \
		&& echo "Docker OK on $(DEPLOY_HOST)" \
		|| (echo "ERROR: Docker cannot run containers on $(DEPLOY_HOST)." && \
		    echo "Typical error: unable to join session keyring (systemd-nspawn restriction)." && \
		    echo "Fix on the nspawn host (Capabilities / keyctl), then retry docker compose up --build." && \
		    exit 1)


test-direct:
	@bash scripts/e2e/direct.sh

test-webdav:
	@bash scripts/e2e/webdav.sh

test: test-direct test-webdav
	@echo "make test : OK"

# Proves the stack runs from published images only: build -> push to a local
# registry -> purge local tags -> pull -> up --no-build. Leaves nothing behind.
test-release:
	@bash scripts/e2e/release-roundtrip.sh

# Guard rail: refuses to release anything that is not committed (submodules
# included). Read-only, safe to run as a CI gate.
release-check:
	@bash scripts/release.sh check

release:
	@bash scripts/release.sh release $(VERSION)

e2e-clean:
	-$(COMPOSE) -p stac-e2e-direct down -v --remove-orphans 2>/dev/null
	-$(COMPOSE) -p stac-e2e-webdav down -v --remove-orphans 2>/dev/null
	@echo "Projets E2E nettoyés"

# ---------------------------------------------------------------- security ---
# Vulnerability / misconfiguration audit of the whole stack: repo contents
# (locked deps, leaked secrets, Dockerfile + compose misconfig) and every image
# referenced by docker-compose.yml.
#   make trivy                          all images of the compose file
#   make trivy IMAGES="img1 img2"       only those images
#   make trivy SEVERITY=MEDIUM,HIGH     change the reporting threshold
#   make trivy EXIT_CODE=1              non-zero exit on findings (CI gate)
TRIVY ?= trivy
TRIVY_SEVERITY ?= HIGH,CRITICAL
TRIVY_EXIT_CODE ?= 0
TRIVY_REPORT ?= output/trivy
# Recursively expanded (?=), so `docker compose config` only runs when the
# recipe is actually executed. --profile tls covers the optional Caddy.
TRIVY_IMAGES ?= $(shell $(COMPOSE) --profile tls config --images 2>/dev/null | sort -u)

trivy: trivy-repo
	@mkdir -p $(TRIVY_REPORT)
	@rc=0; for img in $(TRIVY_IMAGES); do \
		name=$$(echo "$$img" | tr '/:' '__'); \
		echo "=== $$img"; \
		$(TRIVY) image --quiet --severity $(TRIVY_SEVERITY) --exit-code $(TRIVY_EXIT_CODE) \
			--format json --output $(TRIVY_REPORT)/$$name.json "$$img" || rc=1; \
		$(TRIVY) image --severity $(TRIVY_SEVERITY) "$$img" || rc=1; \
	done; \
	exit $$rc

# Repo-level scans: lockfile CVEs, secrets, Dockerfile/compose misconfig.
trivy-repo:
	@mkdir -p $(TRIVY_REPORT)
	$(TRIVY) fs --severity $(TRIVY_SEVERITY) --scanners vuln,secret,misconfig \
		--skip-dirs output,node_modules,.git,.venv,tmp,volumes \
		--format json --output $(TRIVY_REPORT)/repo.json .
	$(TRIVY) fs --severity $(TRIVY_SEVERITY) --scanners vuln,secret,misconfig \
		--skip-dirs output,node_modules,.git,.venv,tmp,volumes .

trivy-clean:
	rm -rf $(TRIVY_REPORT)


