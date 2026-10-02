# Atlasdraw — operator Makefile.
#
# Optional helpers for:
#   - Bringing up either compose stack with a short command.
#   - Rebuilding the bundled world-low-zoom.pmtiles from upstream
#     Protomaps (only needed if you want a fresher basemap than the one
#     committed to the repo).
#   - Extracting a region with streets (see docker-compose.basemap.yml).
#
# Run from repo root: make -f infra/Makefile <target>
# (or symlink: ln -s infra/Makefile Makefile && make <target>)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where to drop downloaded / extracted PMTiles.
DATA_DIR        ?= infra/data
WORLD_PMTILES   ?= $(DATA_DIR)/world.pmtiles
LOWZOOM_PMTILES ?= code/apps/atlas-app/public/data/world-low-zoom.pmtiles
REGION_PMTILES  ?= $(DATA_DIR)/region.pmtiles

# The deepest zoom of a regional extract. Protomaps builds stop at 15; the
# map overzooms past it.
MAXZOOM ?= 15

# The go-pmtiles CLI. `go install` names it go-pmtiles; the release
# binaries name it pmtiles.
PMTILES ?= $(shell command -v pmtiles || command -v go-pmtiles)

# Override to skip the world-pmtiles confirmation prompt (CI/scripted).
SKIP_CONFIRM ?=

# Override to skip the builds.json query and use a pre-hosted URL.
# Recommended for Cloudflare R2 buckets — zero bandwidth fees.
PMTILES_SOURCE_URL ?=

# Compose files.
COMPOSE_MINIMAL := infra/docker-compose.minimal.yml
COMPOSE_FULL    := infra/docker-compose.yml

# ---------------------------------------------------------------------------
# Default + help
# ---------------------------------------------------------------------------

.PHONY: help
help:
	@echo "Atlasdraw — operator targets"
	@echo ""
	@echo "  up-minimal       Bring up sqlite-fs stack (web + storage)"
	@echo "  up-full          Bring up production stack (web + storage + pg + caddy; your S3 bucket)"
	@echo "  down-minimal     Stop minimal stack (volumes survive)"
	@echo "  down-full        Stop full stack (volumes survive)"
	@echo ""
	@echo "  basemap-world    Download full-planet PMTiles (~135 GB) → $(WORLD_PMTILES)"
	@echo "  basemap-region   Extract a region with streets → $(REGION_PMTILES)"
	@echo "                   Usage: make basemap-region BBOX='minLon,minLat,maxLon,maxLat' [MAXZOOM=15]"
	@echo "                   Serve it with infra/docker-compose.basemap.yml."
	@echo "                   Requires the go-pmtiles CLI on PATH."
	@echo "  pmtiles-low-zoom Rebuild world-low-zoom.pmtiles (zoom 0-5 cut, ~43 MB)"
	@echo "                   from \$$WORLD_PMTILES via 'pmtiles extract --maxzoom=5'."
	@echo "                   Requires the go-pmtiles CLI on PATH."
	@echo ""
	@echo "  help             Print this help"

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Compose helpers
# ---------------------------------------------------------------------------

.PHONY: up-minimal
up-minimal:
	docker compose -f $(COMPOSE_MINIMAL) up --build

.PHONY: up-full
up-full:
	@test -f .env || { echo "ERROR: .env missing. Copy infra/.env.example and edit it first."; exit 1; }
	docker compose --env-file .env -f $(COMPOSE_FULL) up -d --build

.PHONY: down-minimal
down-minimal:
	docker compose -f $(COMPOSE_MINIMAL) down

.PHONY: down-full
down-full:
	docker compose --env-file .env -f $(COMPOSE_FULL) down

# ---------------------------------------------------------------------------
# Basemap PMTiles
# ---------------------------------------------------------------------------

# The newest daily planet build, e.g. "20261001.pmtiles" (builds.json keys
# carry the extension).
LATEST_BUILD = curl -fsSL https://build-metadata.protomaps.dev/builds.json \
	| grep -oE '"key"[[:space:]]*:[[:space:]]*"[0-9]+\.pmtiles"' \
	| tail -1 \
	| grep -oE '[0-9]+\.pmtiles'

# Idempotent: skip if WORLD_PMTILES exists already.
# Confirm-or-abort guard: prints size warning, reads stdin. Skip with
# SKIP_CONFIRM=1 (CI / scripted runs).
.PHONY: basemap-world
basemap-world: $(WORLD_PMTILES)

$(WORLD_PMTILES):
	@mkdir -p $(DATA_DIR)
	@echo ""
	@echo "WARNING: This downloads approximately 120 GB to $(WORLD_PMTILES)."
	@echo "         (Protomaps' daily-build planet PMTiles, full resolution.)"
	@echo ""
	@if [ -z "$(SKIP_CONFIRM)" ]; then \
		printf "Proceed? [y/N] "; \
		read ans; \
		case "$$ans" in y|Y) ;; *) echo "Aborted."; exit 1 ;; esac; \
	fi
	@if [ -n "$(PMTILES_SOURCE_URL)" ]; then \
		echo "→ Using PMTILES_SOURCE_URL override: $(PMTILES_SOURCE_URL)"; \
		curl -fL --progress-bar -C - -o $@ "$(PMTILES_SOURCE_URL)"; \
	else \
		echo "→ Resolving latest Protomaps build key from build-metadata.protomaps.dev/builds.json"; \
		KEY=$$($(LATEST_BUILD)); \
		if [ -z "$$KEY" ]; then echo "ERROR: could not resolve build key from builds.json"; exit 2; fi; \
		echo "→ Downloading https://build.protomaps.com/$$KEY → $@"; \
		curl -fL --progress-bar -C - -o $@ "https://build.protomaps.com/$$KEY"; \
	fi
	@echo "✓ Wrote $@"

# Alternative: rebuild the planet from an OSM PBF using planetiler.
# Java 17+ required. Expect ~2 h on an 8-core machine + ~100 GB disk
# scratch space. See https://github.com/onthegomap/planetiler for the
# full invocation. Sketch:
#
#   java -Xmx32g -jar planetiler.jar \
#       --osm-path=planet-latest.osm.pbf \
#       --output=$(WORLD_PMTILES) \
#       --download
#
# Not wired as a recipe because the JAR is not vendored and the resource
# requirements would surprise an unsuspecting operator.

# A region with streets, read by range requests from the newest planet build:
# only the tiles inside BBOX are downloaded. Measured 2026-10-01: central
# Berlin (0.05 x 0.03 degrees) to zoom 15 is 4.6 MB in 2 s; a city is tens of
# MB, a country 1-10 GB. Serve it with infra/docker-compose.basemap.yml.
.PHONY: basemap-region
basemap-region:
	@if [ -z "$(BBOX)" ]; then \
		echo "Usage: make basemap-region BBOX='minLon,minLat,maxLon,maxLat' [MAXZOOM=15]"; \
		exit 1; \
	fi
	@if [ -z "$(PMTILES)" ]; then \
		echo "ERROR: the pmtiles CLI is not on PATH."; \
		echo "       Install: go install github.com/protomaps/go-pmtiles@latest"; \
		echo "       or a release binary from https://github.com/protomaps/go-pmtiles/releases"; \
		exit 1; \
	fi
	@mkdir -p $(DATA_DIR)
	@if [ -n "$(PMTILES_SOURCE_URL)" ]; then \
		SRC="$(PMTILES_SOURCE_URL)"; \
	else \
		KEY=$$($(LATEST_BUILD)); \
		if [ -z "$$KEY" ]; then echo "ERROR: could not resolve build key from builds.json"; exit 2; fi; \
		SRC="https://build.protomaps.com/$$KEY"; \
	fi; \
	echo "→ Extracting bbox=$(BBOX), zoom 0-$(MAXZOOM), from $$SRC"; \
	"$(PMTILES)" extract "$$SRC" "$(REGION_PMTILES)" --bbox="$(BBOX)" --maxzoom=$(MAXZOOM)
	@chmod a+r "$(REGION_PMTILES)"
	@echo "✓ Wrote $(REGION_PMTILES)"

# Rebuild the bundled basemap (zoom 0-5 cut of the full planet).
# Requires the go-pmtiles CLI on PATH:
#   go install github.com/protomaps/go-pmtiles/...@latest
.PHONY: pmtiles-low-zoom
pmtiles-low-zoom: $(WORLD_PMTILES)
	@test -n "$(PMTILES)" || { \
		echo "ERROR: the pmtiles CLI is not on PATH."; \
		echo "       Install: go install github.com/protomaps/go-pmtiles@latest"; \
		exit 1; \
	}
	@echo "→ Extracting zoom 0-5 from $(WORLD_PMTILES) to $(LOWZOOM_PMTILES)"
	"$(PMTILES)" extract --maxzoom=5 "$(WORLD_PMTILES)" "$(LOWZOOM_PMTILES)"
	@echo "✓ Wrote $(LOWZOOM_PMTILES) (zoom 0-5 cut, ~43 MB)"
	@echo "  Commit it to ship in the next atlas-app web image build."
