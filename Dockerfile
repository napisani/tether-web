# syntax=docker/dockerfile:1
# Build stages run on the builder's platform; only the Go link step targets TARGETARCH.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS ui-build
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ui/ ./
ARG VERSION=0.0.0-dev
RUN npm test && TETHER_WEB_VERSION=$VERSION npm run build

FROM --platform=$BUILDPLATFORM golang:1.24-bookworm AS go-build
WORKDIR /src
COPY go.mod ./
COPY internal/ ./internal/
COPY cmd/ ./cmd/
COPY --from=ui-build /src/cmd/tether-web/dist/ ./cmd/tether-web/dist/
ARG VERSION=0.0.0-dev
ARG TARGETOS TARGETARCH
RUN CGO_ENABLED=0 go test ./... \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
        -ldflags="-s -w -X main.version=${VERSION}" -o /tether-web ./cmd/tether-web

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="tether-web" \
      org.opencontainers.image.source="https://github.com/napisani/tether-web" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --from=go-build /tether-web /tether-web
ENV TETHER_WEB_LISTEN=127.0.0.1:5135
EXPOSE 5135
ENTRYPOINT ["/tether-web"]
