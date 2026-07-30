# STAC-OIE — orchestration Docker et tests E2E déploiement
#
# Tests :
#   make test          — HTTP direct (PATH_PREFIX=/ et /stac/) + HTTPS derrière nginx
#   make test-direct   — localhost:TEST_DIRECT_PORT seulement
#   make test-proxy    — nginx HTTPS auto-signé → stack /stac/

.PHONY: build up down sync sync-dry test test-direct test-proxy test-certs e2e-clean rebuild-viewer

COMPOSE := docker compose
PORT ?= 8000
PATH_PREFIX ?= /

TEST_DIRECT_PORT ?= 18001
TEST_BACKEND_PORT ?= 18002
TEST_HTTPS_PORT ?= 18443

export TEST_DIRECT_PORT TEST_BACKEND_PORT TEST_HTTPS_PORT

build:
	$(COMPOSE) down
	$(COMPOSE) build

rebuild-viewer:
	$(COMPOSE) build zarr-viewer-build
	$(COMPOSE) run --rm zarr-viewer-build
	$(COMPOSE) up -d --force-recreate stac-browser

up:
	PATH_PREFIX=$(PATH_PREFIX) PORT=$(PORT) $(COMPOSE) up

down:
	$(COMPOSE) down

sync-dry:
	rsync -anvh --exclude-from .rsyncignore ./ demos:~/stac/

sync:
	rsync -avh --exclude-from .rsyncignore ./ demos:~/stac/


sync-code:
	rsync -avh --exclude volumes --exclude-from .rsyncignore ./ demos:~/stac/


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
