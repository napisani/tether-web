package main

import (
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

func TestCSVTrimsAndDropsEmptyEntries(t *testing.T) {
	got := csv(" tether.test, localhost ,,example.test ")
	want := []string{"tether.test", "localhost", "example.test"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("csv() = %#v, want %#v", got, want)
	}
}
