# STAC-OIE — orchestration Docker et tests E2E déploiement
#
# Tests :
#   make test          — HTTP direct (PATH_PREFIX=/ et /stac/) + HTTPS derrière nginx
#   make test-direct   — localhost:TEST_DIRECT_PORT seulement
#   make test-proxy    — nginx HTTPS auto-signé → stack /stac/

.PHONY: build up down dev dev-up sync sync-dry sync-code deploy-check test test-direct test-proxy test-certs e2e-clean rebuild-viewer submodules

RSYNC_EXCLUDES := --exclude volumes/ --exclude .env --exclude .ssh/ --exclude-from .rsyncignore

COMPOSE := docker compose
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
PORT ?= 8000
PATH_PREFIX ?= /

TEST_DIRECT_PORT ?= 18001
TEST_BACKEND_PORT ?= 18002
TEST_HTTPS_PORT ?= 18443

export TEST_DIRECT_PORT TEST_BACKEND_PORT TEST_HTTPS_PORT

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

build: submodules
	$(COMPOSE) down
	$(COMPOSE) build

rebuild-viewer: submodules
	$(COMPOSE) build zarr-viewer
	$(COMPOSE) run --rm zarr-viewer
	$(COMPOSE) up -d --force-recreate stac-browser

up:
	PATH_PREFIX=$(PATH_PREFIX) PORT=$(PORT) $(COMPOSE) up

.dev-up dev:
	PATH_PREFIX=$(PATH_PREFIX) PORT=$(PORT) $(COMPOSE_DEV) up

dev-up: dev

down:
	$(COMPOSE) down

sync-dry:
	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
	rsync -anvh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)';
	rsync -anvh --exclude .env ./volumes/data/ '$(DEPLOY_DEST)volumes/data/';

sync:
	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
	rsync -avh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)';
	rsync -avh --exclude .env ./volumes/data/ '$(DEPLOY_DEST)volumes/data/';


sync-code:
	@echo "Deploy: $(env) → $(DEPLOY_DEST)"
	rsync -avh --delete $(RSYNC_EXCLUDES) ./ '$(DEPLOY_DEST)'

# Prod (stac) runs inside systemd-nspawn; Docker needs session keyrings (keyctl).
deploy-check:
	@echo "Checking Docker runtime on $(DEPLOY_HOST)..."
	@ssh $(DEPLOY_HOST) 'docker run --rm hello-world >/dev/null' \
		&& echo "Docker OK on $(DEPLOY_HOST)" \
		|| (echo "ERROR: Docker cannot run containers on $(DEPLOY_HOST)." && \
		    echo "Typical error: unable to join session keyring (systemd-nspawn restriction)." && \
		    echo "Fix on the nspawn host (Capabilities / keyctl), then retry docker compose up --build." && \
		    exit 1)


test-certs:
	@mkdir -p tests/certs
	@if [ ! -f tests/certs/cert.pem ]; then \
		openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
		  -keyout tests/certs/key.pem -out tests/certs/cert.pem \
		  -subj "/CN=localhost"; \
		echo "Certificats générés dans tests/certs/"; \
	fi

test-direct:
	@bash scripts/e2e/direct.sh

test-proxy: test-certs
	@bash scripts/e2e/proxy-https.sh

test: test-direct test-proxy
	@echo "make test : OK"

e2e-clean:
	-$(COMPOSE) -p stac-e2e-direct-root down -v --remove-orphans 2>/dev/null
	-$(COMPOSE) -p stac-e2e-direct-stac down -v --remove-orphans 2>/dev/null
	-$(COMPOSE) -p stac-e2e-proxy down -v --remove-orphans 2>/dev/null
	@echo "Projets E2E nettoyés"


bind :
	sudo mount --bind ~/zarr-cam/data/out/all.zarr/ volumes/data/fisheye/sophia.zarr
	sudo mount --bind ~/zarr-cam/tmp/ome_ngff/stores/ volumes/data/fisheye/ome
