# dobee-work shortcuts for Web and Desktop application commands. The package.json
# scripts they call stay the source of truth; docs/development.md documents both.
.DEFAULT_GOAL := help
.PHONY: help build build-desktop web desktop dev-web dev-desktop dev-desktop-watch

PNPM ?= pnpm
ARGS ?=

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make build-desktop pnpm run build:desktop-runtime  Desktop runtime build"
	@echo "make web          pnpm run start:web       serve the built Web artifacts from source"
	@echo "make desktop      pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-web      pnpm run dev:web         build, serve, and rebuild Web on source edits"
	@echo "make dev-desktop  pnpm run dev:desktop     build Desktop runtime, then launch"
	@echo "make dev-desktop-watch pnpm run dev:desktop:watch  build, launch, and watch Desktop"
	@echo "ARGS='--no-open --port 3081' forwards options to the launched application;"
	@echo "Web accepts dsh web flags; Desktop accepts --watch and --watch-interval."

build:
	$(PNPM) run build

build-desktop:
	$(PNPM) run build:desktop-runtime $(ARGS)

web:
	$(PNPM) run start:web $(ARGS)

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-web:
	$(PNPM) run dev:web $(ARGS)

dev-desktop:
	$(PNPM) run dev:desktop $(ARGS)

dev-desktop-watch:
	$(PNPM) run dev:desktop:watch $(ARGS)
