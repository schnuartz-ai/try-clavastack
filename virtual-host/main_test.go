package main

import (
	"bufio"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func maskedFrame(opcode byte, payload []byte) []byte {
	mask := [4]byte{0x12, 0x34, 0x56, 0x78}
	frame := []byte{0x80 | opcode}
	if len(payload) < 126 {
		frame = append(frame, 0x80|byte(len(payload)))
	} else {
		frame = append(frame, 0x80|126, byte(len(payload)>>8), byte(len(payload)))
	}
	frame = append(frame, mask[:]...)
	for i, value := range payload {
		frame = append(frame, value^mask[i%4])
	}
	return frame
}

func readServerFrame(t *testing.T, reader *bufio.Reader) (byte, []byte) {
	t.Helper()
	first, err := reader.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	second, err := reader.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if second&0x80 != 0 {
		t.Fatal("server frame must not be masked")
	}
	length := int(second & 0x7f)
	if length == 126 {
		var size [2]byte
		if _, err := io.ReadFull(reader, size[:]); err != nil {
			t.Fatal(err)
		}
		length = int(binary.BigEndian.Uint16(size[:]))
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		t.Fatal(err)
	}
	return first & 0x0f, payload
}

func TestAllowedOrigin(t *testing.T) {
	for _, origin := range []string{
		"https://try.clavastack.com",
		"http://127.0.0.1:8788",
		"http://localhost:8765",
	} {
		if !allowedOrigin(origin) {
			t.Fatalf("expected origin to be allowed: %s", origin)
		}
	}
	for _, origin := range []string{"https://example.com", "http://try.clavastack.com", "null", ""} {
		if allowedOrigin(origin) {
			t.Fatalf("expected origin to be rejected: %s", origin)
		}
	}
}

func TestConnectedSimulatorRedirect(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8788/connected?probe=usb", nil)
	serveConnectedSimulator(recorder, request)
	response := recorder.Result()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusFound)
	}
	location := response.Header.Get("Location")
	redirectURL, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	query := redirectURL.Query()
	if redirectURL.Host != webAddress || query.Get("virtual-host") != "1" || query.Get("variant") != "diy" ||
		query.Get("probe") != "usb" {
		t.Fatalf("location = %q", location)
	}
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", response.Header.Get("Cache-Control"))
	}
}

func TestNewestBrowserSupersedesPrevious(t *testing.T) {
	b := &bridge{}
	firstServer, firstClient := net.Pipe()
	defer firstClient.Close()
	first := &wsConn{conn: firstServer, reader: bufio.NewReader(firstServer)}
	go b.attachBrowser(first, "first-tab")
	firstReader := bufio.NewReader(firstClient)
	if opcode, _ := readServerFrame(t, firstReader); opcode != 1 {
		t.Fatalf("first hello opcode = %d, want text", opcode)
	}

	secondServer, secondClient := net.Pipe()
	defer secondClient.Close()
	second := &wsConn{conn: secondServer, reader: bufio.NewReader(secondServer)}
	go b.attachBrowser(second, "second-tab")
	opcode, payload := readServerFrame(t, firstReader)
	if opcode != 8 || len(payload) < 2 || binary.BigEndian.Uint16(payload[:2]) != 4001 {
		t.Fatalf("superseded frame = (%d, %q)", opcode, payload)
	}
	if opcode, _ := readServerFrame(t, bufio.NewReader(secondClient)); opcode != 1 {
		t.Fatalf("second hello opcode = %d, want text", opcode)
	}
}

func TestCurrentBrowserBlocksLegacyReconnect(t *testing.T) {
	b := &bridge{}
	if !b.acceptsBrowserClient("") {
		t.Fatal("legacy browser should be accepted before a current page connects")
	}
	b.browserClientID = "current-tab"
	if b.acceptsBrowserClient("") {
		t.Fatal("legacy browser reconnect should be rejected after a current page connects")
	}
	if !b.acceptsBrowserClient("new-tab") {
		t.Fatal("a new current browser should be accepted")
	}
}

func TestConnectedSimulatorDropsTemporaryBuild(t *testing.T) {
	var received string
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = r.URL.String()
		w.WriteHeader(http.StatusNoContent)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet,
		"http://127.0.0.1:8788/?virtual-host=1&variant=play&buildVariant=fast&manifest=/api/ab/pointer/expired", nil)
	serveStableSimulator(upstream, recorder, request)
	receivedURL, err := url.Parse(received)
	if err != nil {
		t.Fatal(err)
	}
	query := receivedURL.Query()
	if receivedURL.Path != "/" || query.Get("virtual-host") != "1" || query.Get("variant") != "diy" ||
		query.Has("manifest") || query.Has("buildVariant") {
		t.Fatalf("upstream URL = %q", received)
	}
}

func TestBridgeRoundTrip(t *testing.T) {
	b := &bridge{}
	browserServer, browserClient := net.Pipe()
	defer browserClient.Close()
	go b.handleBrowser(&wsConn{conn: browserServer, reader: bufio.NewReader(browserServer)}, "round-trip-tab")
	browserReader := bufio.NewReader(browserClient)
	if opcode, _ := readServerFrame(t, browserReader); opcode != 1 {
		t.Fatalf("hello opcode = %d, want text", opcode)
	}

	hostServer, hostClient := net.Pipe()
	defer hostClient.Close()
	go b.handleHost(hostServer)
	if opcode, _ := readServerFrame(t, browserReader); opcode != 1 {
		t.Fatalf("host status opcode = %d, want text", opcode)
	}

	command := []byte("\r\n\r\nfingerprint\r\n")
	go func() { _, _ = hostClient.Write(command) }()
	opcode, payload := readServerFrame(t, browserReader)
	if opcode != 2 || string(payload) != string(command) {
		t.Fatalf("host-to-browser frame = (%d, %q)", opcode, payload)
	}

	response := []byte("ACK\r\ndeadbeef\r\n")
	if _, err := browserClient.Write(maskedFrame(2, response)); err != nil {
		t.Fatal(err)
	}
	_ = hostClient.SetReadDeadline(time.Now().Add(time.Second))
	received := make([]byte, len(response))
	if _, err := io.ReadFull(hostClient, received); err != nil {
		t.Fatal(err)
	}
	if string(received) != string(response) {
		t.Fatalf("browser-to-host bytes = %q", received)
	}
}
