package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	webAddress = "127.0.0.1:8788"
	hwiAddress = "127.0.0.1:8789"
	maxFrame   = 16 << 20
)

var version = "dev"

type wsConn struct {
	conn    net.Conn
	reader  *bufio.Reader
	writeMu sync.Mutex
}

func (ws *wsConn) writeFrame(opcode byte, payload []byte) error {
	ws.writeMu.Lock()
	defer ws.writeMu.Unlock()
	header := []byte{0x80 | opcode}
	switch {
	case len(payload) < 126:
		header = append(header, byte(len(payload)))
	case len(payload) <= 0xffff:
		header = append(header, 126, byte(len(payload)>>8), byte(len(payload)))
	default:
		header = append(header, 127)
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(payload)))
		header = append(header, size[:]...)
	}
	if _, err := ws.conn.Write(header); err != nil {
		return err
	}
	_, err := ws.conn.Write(payload)
	return err
}

func (ws *wsConn) readFrame() (byte, []byte, error) {
	first, err := ws.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	second, err := ws.reader.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	if first&0x80 == 0 {
		return 0, nil, errors.New("fragmented WebSocket frames are not supported")
	}
	opcode := first & 0x0f
	masked := second&0x80 != 0
	if !masked {
		return 0, nil, errors.New("unmasked client frame")
	}
	length := uint64(second & 0x7f)
	if length == 126 {
		var size [2]byte
		if _, err := io.ReadFull(ws.reader, size[:]); err != nil {
			return 0, nil, err
		}
		length = uint64(binary.BigEndian.Uint16(size[:]))
	} else if length == 127 {
		var size [8]byte
		if _, err := io.ReadFull(ws.reader, size[:]); err != nil {
			return 0, nil, err
		}
		length = binary.BigEndian.Uint64(size[:])
	}
	if length > maxFrame {
		return 0, nil, fmt.Errorf("WebSocket frame too large: %d bytes", length)
	}
	var mask [4]byte
	if _, err := io.ReadFull(ws.reader, mask[:]); err != nil {
		return 0, nil, err
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(ws.reader, payload); err != nil {
		return 0, nil, err
	}
	for i := range payload {
		payload[i] ^= mask[i%4]
	}
	return opcode, payload, nil
}

type bridge struct {
	mu              sync.Mutex
	browser         *wsConn
	browserClientID string
	host            net.Conn
}

func (b *bridge) acceptsBrowserClient(clientID string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	// Compatibility is allowed only until the first current browser page has
	// identified itself. This prevents already-open pre-1.0.4 tabs from
	// repeatedly taking the bridge back after an upgrade.
	return clientID != "" || b.browserClientID == ""
}

func (b *bridge) browserSnapshot() *wsConn {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.browser
}

func (b *bridge) hostSnapshot() net.Conn {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.host
}

func (b *bridge) sendStatus(kind string, connected bool) {
	ws := b.browserSnapshot()
	if ws == nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{"type": kind, "connected": connected})
	_ = ws.writeFrame(1, payload)
}

func (b *bridge) attachBrowser(ws *wsConn, clientID string) {
	b.mu.Lock()
	previous := b.browser
	b.browser = ws
	if clientID != "" {
		b.browserClientID = clientID
	}
	hostConnected := b.host != nil
	b.mu.Unlock()
	if previous != nil {
		const reason = "Another simulator tab became active"
		payload := make([]byte, 2, 2+len(reason))
		binary.BigEndian.PutUint16(payload, 4001)
		payload = append(payload, reason...)
		_ = previous.writeFrame(8, payload)
		_ = previous.conn.Close()
	}
	hello, _ := json.Marshal(map[string]any{
		"type": "hello", "version": version, "hostConnected": hostConnected,
	})
	_ = ws.writeFrame(1, hello)
	log.Printf("Browser simulator connected")
}

func (b *bridge) detachBrowser(ws *wsConn) {
	b.mu.Lock()
	if b.browser == ws {
		b.browser = nil
	}
	b.mu.Unlock()
	_ = ws.conn.Close()
	log.Printf("Browser simulator disconnected")
}

func (b *bridge) handleBrowser(ws *wsConn, clientID string) {
	b.attachBrowser(ws, clientID)
	defer b.detachBrowser(ws)
	for {
		opcode, payload, err := ws.readFrame()
		if err != nil {
			return
		}
		switch opcode {
		case 2:
			host := b.hostSnapshot()
			if host != nil {
				if _, err := host.Write(payload); err != nil {
					log.Printf("Unable to write firmware response to Specter Desktop: %v", err)
				}
			}
		case 8:
			_ = ws.writeFrame(8, nil)
			return
		case 9:
			_ = ws.writeFrame(10, payload)
		}
	}
}

func (b *bridge) handleHost(conn net.Conn) {
	b.mu.Lock()
	if b.host != nil {
		// Specter Desktop first opens and immediately closes a probe connection,
		// then opens the real query connection. Replace a not-yet-reaped probe
		// instead of racing and rejecting the query.
		_ = b.host.Close()
	}
	if b.browser == nil {
		b.mu.Unlock()
		_ = conn.Close()
		return
	}
	b.host = conn
	b.mu.Unlock()
	b.sendStatus("host", true)
	log.Printf("Specter Desktop connected")
	defer func() {
		b.mu.Lock()
		wasCurrent := b.host == conn
		if b.host == conn {
			b.host = nil
		}
		b.mu.Unlock()
		_ = conn.Close()
		if wasCurrent {
			b.sendStatus("host", false)
		}
		log.Printf("Specter Desktop disconnected")
	}()

	buffer := make([]byte, 32*1024)
	for {
		n, err := conn.Read(buffer)
		if n > 0 {
			ws := b.browserSnapshot()
			if ws == nil || ws.writeFrame(2, buffer[:n]) != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func allowedOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	return (parsed.Scheme == "https" && host == "try.clavastack.com") ||
		((parsed.Scheme == "http" || parsed.Scheme == "https") &&
			(host == "127.0.0.1" || host == "localhost" || host == "::1"))
}

func acceptWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !allowedOrigin(r.Header.Get("Origin")) {
		return nil, errors.New("origin is not allowed")
	}
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		!strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return nil, errors.New("not a WebSocket upgrade")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" || r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("invalid WebSocket handshake")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("HTTP connection cannot be upgraded")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	accept := base64.StdEncoding.EncodeToString(digest[:])
	_, err = fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
	if err == nil {
		err = rw.Flush()
	}
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &wsConn{conn: conn, reader: rw.Reader}, nil
}

func openBrowser(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		command = exec.Command("open", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func connectedSimulatorURL(probe string) string {
	query := url.Values{
		"virtual-host":         {"1"},
		"variant":              {"diy"},
		"virtual-host-version": {version},
	}
	if probe == "usb" {
		query.Set("probe", probe)
	}
	return "http://" + webAddress + "/?" + query.Encode()
}

func serveConnectedSimulator(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, connectedSimulatorURL(r.URL.Query().Get("probe")), http.StatusFound)
}

func serveStableSimulator(proxy http.Handler, w http.ResponseWriter, r *http.Request) {
	// A Virtual Host session is deliberately tied to the normal Specter DIY
	// build. Temporary A/B manifest URLs expire when the build service restarts
	// and must never leak into the PC-connected simulator.
	if r.URL.Path == "/" || r.URL.Path == "/index.html" {
		query := r.URL.Query()
		if query.Get("virtual-host") == "1" {
			query.Del("manifest")
			query.Del("buildVariant")
			query.Set("variant", "diy")
			r.URL.RawQuery = query.Encode()
		}
	}
	proxy.ServeHTTP(w, r)
}

func main() {
	upstreamFlag := flag.String("site", "https://try.clavastack.com", "simulator site to open through the local bridge")
	noOpen := flag.Bool("no-open", false, "do not open the connected simulator in the default browser")
	flag.Parse()
	upstream, err := url.Parse(*upstreamFlag)
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") {
		log.Fatalf("Invalid simulator site %q", *upstreamFlag)
	}

	b := &bridge{}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Set("X-ClavaStack-Virtual-Host", version)
		contentType := response.Header.Get("Content-Type")
		if strings.Contains(contentType, "text/html") ||
			strings.Contains(contentType, "javascript") ||
			strings.Contains(contentType, "json") {
			response.Header.Set("Cache-Control", "no-store")
			response.Header.Del("ETag")
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "The simulator site could not be reached: "+err.Error(), http.StatusBadGateway)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/bridge", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("client")
		if !b.acceptsBrowserClient(clientID) {
			http.Error(w, "Open the newest connected simulator tab", http.StatusConflict)
			return
		}
		ws, err := acceptWebSocket(w, r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		b.handleBrowser(ws, clientID)
	})
	mux.HandleFunc("/virtual-host-health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "https://try.clavastack.com")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "version": version})
	})
	mux.HandleFunc("/connected", serveConnectedSimulator)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		serveStableSimulator(proxy, w, r)
	})

	hwiListener, err := net.Listen("tcp", hwiAddress)
	if err != nil {
		log.Fatalf("Cannot open the Specter Desktop port %s: %v", hwiAddress, err)
	}
	defer hwiListener.Close()
	go func() {
		for {
			conn, err := hwiListener.Accept()
			if err != nil {
				return
			}
			go b.handleHost(conn)
		}
	}()

	server := &http.Server{Addr: webAddress, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Cannot start the local browser bridge: %v", err)
		}
	}()

	connectedURL := "http://" + webAddress + "/connected"
	fmt.Printf("\nClavaStack Virtual Host %s\n", version)
	fmt.Printf("Connected simulator: %s\n", connectedURL)
	fmt.Printf("Specter Desktop:     %s\n\n", hwiAddress)
	fmt.Println("Keep this window open while using Specter Desktop.")
	fmt.Println("Only use public test seeds in the browser simulator.")
	if !*noOpen {
		if err := openBrowser(connectedURL); err != nil {
			log.Printf("Open %s in your browser", connectedURL)
		}
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	_ = server.Close()
}
