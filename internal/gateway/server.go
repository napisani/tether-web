package gateway

import (
	"io/fs"
	"net/http"
)

type Config struct {
	AllowedHosts []string
}

func NewHandler(bus Bus, assets fs.FS, config Config) http.Handler {
	mux := http.NewServeMux()
	registerHealthHandlers(mux, bus)
	registerStateHandler(mux, bus)
	registerEventHandler(mux, bus)
	registerCommandHandler(mux, bus)
	registerAssetHandler(mux, assets)
	return securityHeaders(validateBrowserRequest(mux, config.AllowedHosts))
}
