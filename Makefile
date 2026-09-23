# STAC-OIE — orchestration Docker et tests E2E déploiement
#
# TLS is handled by an external reverse proxy: the stack itself is HTTP-only.
#
# Tests :
#   make test          — HTTP direct (:/TEST_DIRECT_PORT) + WebDAV /data
#   make test-direct   — http://localhost:TEST_DIRECT_PORT
#   make test-webdav   — WebDAV /data (lecture publique, écriture admin)

.PHONY: build rebuild up down dev dev-up sync sync-dry sync-code deploy deploy-check test test-direct test-webdav e2e-clean rebuild-viewer submodules

RSYNC_EXCLUDES := --exclude volumes/ --exclude .env --exclude .ssh/ --exclude-from .rsyncignore

COMPOSE := docker compose
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

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
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_PATH) && docker compose down && docker compose build && docker compose up -d'

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

e2e-clean:
	-$(COMPOSE) -p stac-e2e-direct down -v --remove-orphans 2>/dev/null
	-$(COMPOSE) -p stac-e2e-webdav down -v --remove-orphans 2>/dev/null
	@echo "Projets E2E nettoyés"


