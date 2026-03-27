#!/usr/bin/env python3
"""Minimal HTTP API to restart simulators."""
import http.server, subprocess, json, os

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/restart/sim1':
            sim = '1'
        elif self.path == '/restart/sim2':
            sim = '2'
        elif self.path == '/restart/both':
            sim = 'both'
        else:
            self.send_response(404)
            self.end_headers()
            return
        
        # Add CORS
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        result = subprocess.run(
            ['/home/finn/restart-simulator.sh', sim],
            capture_output=True, text=True, timeout=30
        )
        self.wfile.write(json.dumps({
            'ok': True, 'sim': sim,
            'output': result.stdout[-500:]
        }).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.end_headers()

    def log_message(self, *args): pass

server = http.server.HTTPServer(('127.0.0.1', 8095), Handler)
print("Restart API on :8095")
server.serve_forever()
