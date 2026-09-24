package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/napisani/tether-web/internal/daemon"
	"github.com/napisani/tether-web/internal/gateway"
)

//go:embed all:dist
var embeddedAssets embed.FS

func main() {
	if err := run(); err != nil {
		slog.Error("tether-web stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	listenAddress := envOr("TETHER_WEB_LISTEN", "127.0.0.1:5135")
	allowedHosts := csv(os.Getenv("TETHER_WEB_ALLOWED_HOSTS"))
	wildcard, err := isWildcardListenAddress(listenAddress)
	if err != nil {
		return err
	}
	if len(allowedHosts) == 0 && wildcard {
		return errors.New("TETHER_WEB_ALLOWED_HOSTS is required when listening on a wildcard address")
	}
	allowedHosts = append(allowedHosts, "127.0.0.1", "localhost", "::1")
	auth, err := gatewayAuth(listenAddress)
	if err != nil {
		return err
	}

	socketPath := os.Getenv("TETHER_SOCKET_PATH")
	if socketPath == "" {
		runtimeDirectory := envOr("XDG_RUNTIME_DIR", filepath.Join("/run/user", strconv.Itoa(os.Getuid())))
		socketPath = filepath.Join(runtimeDirectory, "tether", "tetherd.sock")
	}

	assets, err := fs.Sub(embeddedAssets, "dist")
	if err != nil {
		return fmt.Errorf("opening embedded web assets: %w", err)
	}
	if _, err := fs.Stat(assets, "index.html"); err != nil {
		return errors.New("web assets are missing; run the UI build before compiling tether-web")
	}
	bus := daemon.New(socketPath, time.Second)
	go bus.Run(ctx)

	server := &http.Server{
		Addr:              listenAddress,
		Handler:           gateway.NewHandler(bus, assets, gateway.Config{AllowedHosts: allowedHosts, StagingDir: filepath.Dir(socketPath), Auth: auth}),
		ReadTimeout:       10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("tether web listening", "address", listenAddress, "socket", socketPath)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownContext)
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serving HTTP: %w", err)
	}
}

func isWildcardListenAddress(address string) (bool, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false, fmt.Errorf("parsing TETHER_WEB_LISTEN %q: %w", address, err)
	}
	if host == "" {
		return true, nil
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsUnspecified(), nil
}

func gatewayAuth(address string) (*gateway.BasicCredentials, error) {
	username := os.Getenv("TETHER_WEB_AUTH_USER")
	passwordFile := os.Getenv("TETHER_WEB_AUTH_PASSWORD_FILE")
	host, _, _ := net.SplitHostPort(address) // validated by isWildcardListenAddress
	ip := net.ParseIP(host)
	loopback := strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
	if username == "" && passwordFile == "" && loopback {
		return nil, nil
	}
	if username == "" || strings.ContainsAny(username, ":\r\n") || passwordFile == "" {
		return nil, errors.New("TETHER_WEB_AUTH_USER and TETHER_WEB_AUTH_PASSWORD_FILE are required for non-loopback listeners")
	}
	contents, err := os.ReadFile(passwordFile)
	if err != nil {
		return nil, fmt.Errorf("reading TETHER_WEB_AUTH_PASSWORD_FILE: %w", err)
	}
	password := strings.TrimSuffix(strings.TrimSuffix(string(contents), "\n"), "\r")
	if len(password) < 16 || len(password) > 4096 {
		return nil, errors.New("TETHER_WEB_AUTH_PASSWORD_FILE must contain a password between 16 and 4096 bytes")
	}
	return &gateway.BasicCredentials{Username: username, Password: password}, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func csv(value string) []string {
	var entries []string
	for _, entry := range strings.Split(value, ",") {
		if entry = strings.TrimSpace(entry); entry != "" {
			entries = append(entries, entry)
		}
	}
	return entries
}
