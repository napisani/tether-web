package gateway

import (
	"io/fs"
	"net/http"
)

type Config struct {
	AllowedHosts []string
	StagingDir   string
	Auth         *BasicCredentials
}

func NewHandler(bus Bus, assets fs.FS, config Config) http.Handler {
	mux := http.NewServeMux()
	registerHealthHandlers(mux, bus)
	registerStateHandler(mux, bus)
	registerEventHandler(mux, bus)
	registerCommandHandler(mux, bus, newUploadStore(bus, config.StagingDir))
	registerAssetHandler(mux, assets)
	return securityHeaders(validateBrowserRequest(requireBrowserAuth(mux, config.Auth), config.AllowedHosts))
}
