package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestIsWildcardListenAddress(t *testing.T) {
	for _, test := range []struct {
		name     string
		address  string
		wildcard bool
		wantErr  bool
	}{
		{name: "IPv4 wildcard", address: "0.0.0.0:5135", wildcard: true},
		{name: "IPv6 wildcard", address: "[::]:5135", wildcard: true},
		{name: "empty host", address: ":5135", wildcard: true},
		{name: "loopback IP", address: "127.0.0.1:5135"},
		{name: "hostname", address: "localhost:5135"},
		{name: "invalid", address: "localhost", wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			wildcard, err := isWildcardListenAddress(test.address)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr = %v", err, test.wantErr)
			}
			if wildcard != test.wildcard {
				t.Fatalf("wildcard = %v, want %v", wildcard, test.wildcard)
			}
		})
	}
}

func TestGatewayAuthRequiresCredentialsOffLoopback(t *testing.T) {
	t.Setenv("TETHER_WEB_AUTH_USER", "")
	t.Setenv("TETHER_WEB_AUTH_PASSWORD_FILE", "")
	for _, address := range []string{"127.0.0.1:5135", "[::1]:5135", "localhost:5135"} {
		auth, err := gatewayAuth(address)
		if err != nil || auth != nil {
			t.Fatalf("loopback %s: auth = %#v, err = %v", address, auth, err)
		}
	}
	for _, address := range []string{"0.0.0.0:5135", "[::]:5135", "192.0.2.1:5135", "tether.test:5135"} {
		if _, err := gatewayAuth(address); err == nil {
			t.Fatalf("remote listener %s accepted without credentials", address)
		}
	}

	passwordFile := filepath.Join(t.TempDir(), "password")
	if err := os.WriteFile(passwordFile, []byte("a-long-private-password\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TETHER_WEB_AUTH_USER", "owner")
	t.Setenv("TETHER_WEB_AUTH_PASSWORD_FILE", passwordFile)
	auth, err := gatewayAuth("0.0.0.0:5135")
	if err != nil || auth == nil || auth.Username != "owner" || auth.Password != "a-long-private-password" {
		t.Fatalf("auth = %#v, err = %v", auth, err)
	}
	t.Setenv("TETHER_WEB_AUTH_USER", "")
	if _, err := gatewayAuth("127.0.0.1:5135"); err == nil {
		t.Fatal("accepted partial credentials on loopback")
	}
}

func TestCSVTrimsAndDropsEmptyEntries(t *testing.T) {
	got := csv(" tether.test, localhost ,,example.test ")
	want := []string{"tether.test", "localhost", "example.test"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("csv() = %#v, want %#v", got, want)
	}
}
