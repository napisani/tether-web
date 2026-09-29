.PHONY: build check clean docker lint test test-e2e ui-deps version

UI_DIR := ui
BINARY := bin/tether-web
IMAGE ?= tether-web:dev
# Release tags are vX.Y.Z; untagged commits describe as X.Y.Z-N-gSHA.
VERSION ?= $(patsubst v%,%,$(shell git describe --tags --match 'v[0-9]*.[0-9]*.[0-9]*' --dirty 2>/dev/null || echo 0.0.0-dev))
REVISION ?= $(shell git rev-parse HEAD 2>/dev/null || echo unknown)

version:
	@echo $(VERSION)

ui-deps:
	cd $(UI_DIR) && npm ci

build: ui-deps
	cd $(UI_DIR) && TETHER_WEB_VERSION=$(VERSION) npm run build
	mkdir -p $(dir $(BINARY))
	CGO_ENABLED=0 go build -trimpath -ldflags='-X main.version=$(VERSION)' -o $(BINARY) ./cmd/tether-web

check: ui-deps lint
	test -z "$$(gofmt -l cmd internal)"
	go vet ./...
	go test -race ./...
	cd $(UI_DIR) && npm test
	cd $(UI_DIR) && npm run build

lint: ui-deps
	cd $(UI_DIR) && npm run lint

test:
	go test -race ./...

test-e2e: ui-deps
	cd $(UI_DIR) && npm run test:e2e

docker:
	docker build --build-arg VERSION=$(VERSION) --build-arg REVISION=$(REVISION) -t $(IMAGE) .

clean:
	rm -rf bin $(UI_DIR)/node_modules $(UI_DIR)/test-results $(UI_DIR)/playwright-report
	find cmd/tether-web/dist -mindepth 1 ! -name .gitkeep -delete
