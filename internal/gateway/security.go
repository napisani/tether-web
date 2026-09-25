package gateway

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

type BasicCredentials struct {
	Username string
	Password string
}

func requireBrowserAuth(next http.Handler, credentials *BasicCredentials) http.Handler {
	if credentials == nil {
		return next
	}
	usernameHash := sha256.Sum256([]byte(credentials.Username))
	passwordHash := sha256.Sum256([]byte(credentials.Password))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (r.URL.Path == "/healthz" || r.URL.Path == "/readyz") && r.Method == http.MethodGet {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		username, password, ok := r.BasicAuth()
		providedUsername := sha256.Sum256([]byte(username))
		providedPassword := sha256.Sum256([]byte(password))
		validUsername := subtle.ConstantTimeCompare(providedUsername[:], usernameHash[:])
		validPassword := subtle.ConstantTimeCompare(providedPassword[:], passwordHash[:])
		if !ok || validUsername&validPassword != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="Tether", charset="UTF-8"`)
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func validateBrowserRequest(next http.Handler, allowedHosts []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(allowedHosts) > 0 && !slices.Contains(allowedHosts, hostname(r.Host)) {
			http.Error(w, "unrecognized host", http.StatusMisdirectedRequest)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "cross-site request rejected", http.StatusForbidden)
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host) {
				http.Error(w, "cross-origin request rejected", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func hostname(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(hostport, "[]")
}

func sameOrigin(origin, requestHost string) bool {
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == requestHost
}
