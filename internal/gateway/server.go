package gateway

import (
	"io/fs"
	"net/http"
)

type Config struct {
	AllowedHosts []string
	StagingDir   string
	Uploads      *Uploads
	Auth         *BasicCredentials
	MCPHandler   http.Handler
}

func NewHandler(bus Bus, assets fs.FS, config Config) http.Handler {
	mux := http.NewServeMux()
	registerHealthHandlers(mux, bus)
	registerStateHandler(mux, bus)
	registerEventHandler(mux, bus)
	uploads := config.Uploads
	if uploads == nil {
		uploads = NewUploads(bus, config.StagingDir)
	}
	registerCommandHandler(mux, bus, uploads)
	if config.MCPHandler != nil {
		mux.Handle("/mcp", config.MCPHandler)
	} else {
		mux.Handle("/mcp", http.NotFoundHandler())
	}
	registerAssetHandler(mux, assets)
	return securityHeaders(validateBrowserRequest(requireBrowserAuth(mux, config.Auth), config.AllowedHosts))
}
