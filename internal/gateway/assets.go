package gateway

import (
	"io/fs"
	"net/http"
	"strings"
)

func registerAssetHandler(mux *http.ServeMux, assets fs.FS) {
	if assets == nil {
		return
	}
	fileServer := http.FileServer(http.FS(assets))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	}))
}
