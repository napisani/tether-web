# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS ui-build
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY ui/ ./
RUN npm test && npm run build

FROM golang:1.24-bookworm AS go-build
WORKDIR /src
COPY go.mod ./
COPY internal/ ./internal/
COPY cmd/ ./cmd/
COPY --from=ui-build /src/cmd/tether-web/dist/ ./cmd/tether-web/dist/
RUN CGO_ENABLED=0 go test ./... \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /tether-web ./cmd/tether-web

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go-build /tether-web /tether-web
ENV TETHER_WEB_LISTEN=127.0.0.1:5135
EXPOSE 5135
ENTRYPOINT ["/tether-web"]
