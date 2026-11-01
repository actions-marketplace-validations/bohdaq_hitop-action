"""Local mock API for the self-test: python3 test/mock_server.py <port>."""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "s3cret-value"


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/ping":
            self.send_json(200, {"status": "ok"})
        elif self.path == "/secure":
            if self.headers.get("Authorization") == f"Bearer {TOKEN}":
                self.send_json(200, {"user": "ada"})
            else:
                self.send_json(401, {"error": "unauthorized"})
        elif self.path.startswith("/users/1"):
            self.send_json(200, {"id": 1, "name": "Ada"})
        elif self.path == "/broken":
            self.send_json(500, {"error": "boom"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        self.send_json(200, {"id": 7})

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
