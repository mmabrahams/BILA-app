#!/usr/bin/env python3
"""BILA Dimitri-Miquel - Meeting App Server"""

import json
import os
import time
import random
import string
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
import queue

PORT = int(os.environ.get('PORT', 3456))
DATA_DIR = os.environ.get('DATA_DIR', os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(DATA_DIR, 'data.json')
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

# SSE clients: dict of client_id -> queue
sse_clients = {}
sse_lock = threading.Lock()


def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"weeks": {}, "stage": {"completedWeeks": []}}


def save_data(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def create_empty_week(week_id):
    return {
        "id": week_id,
        "weekplan": [],
        "beginMeeting": {
            "watGedaan": "",
            "stageVoortgang": "",
            "vragenMiquel": "",
            "vragenDimitri": "",
            "notities": ""
        },
        "eindeMeeting": {
            "watGedaan": "",
            "stageVoortgang": "",
            "terugblikGelukt": "",
            "terugblikTegenaan": "",
            "vragenMiquel": "",
            "vragenDimitri": "",
            "notities": ""
        }
    }


def generate_client_id():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=12))


def broadcast(data, exclude_client_id=None):
    msg = json.dumps(data, ensure_ascii=False)
    with sse_lock:
        dead_clients = []
        for cid, q in sse_clients.items():
            if cid != exclude_client_id:
                try:
                    q.put_nowait(('update', msg))
                except queue.Full:
                    dead_clients.append(cid)
        for cid in dead_clients:
            del sse_clients[cid]


def broadcast_stage(data, exclude_client_id=None):
    msg = json.dumps(data, ensure_ascii=False)
    with sse_lock:
        dead_clients = []
        for cid, q in sse_clients.items():
            if cid != exclude_client_id:
                try:
                    q.put_nowait(('stage-update', msg))
                except queue.Full:
                    dead_clients.append(cid)
        for cid in dead_clients:
            del sse_clients[cid]


class BILAHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format, *args):
        # Quieter logging - only log non-SSE requests
        if '/api/events' not in str(args[0]):
            super().log_message(format, *args)

    def add_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id')

    def do_OPTIONS(self):
        self.send_response(204)
        self.add_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/events':
            self.handle_sse()
        elif path.startswith('/api/weeks/'):
            self.handle_get_week(path)
        elif path == '/api/stage':
            self.handle_get_stage()
        else:
            super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/weeks/'):
            self.handle_put_week(path)
        elif path == '/api/stage':
            self.handle_put_stage()
        else:
            self.send_error(404)

    def handle_sse(self):
        client_id = generate_client_id()
        q = queue.Queue(maxsize=100)

        with sse_lock:
            sse_clients[client_id] = q

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        # Send client ID
        connected_msg = json.dumps({"clientId": client_id})
        self.wfile.write(f"event: connected\ndata: {connected_msg}\n\n".encode('utf-8'))
        self.wfile.flush()

        try:
            while True:
                try:
                    event_type, data = q.get(timeout=25)
                    self.wfile.write(f"event: {event_type}\ndata: {data}\n\n".encode('utf-8'))
                    self.wfile.flush()
                except queue.Empty:
                    # Send heartbeat
                    self.wfile.write(": heartbeat\n\n".encode('utf-8'))
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with sse_lock:
                sse_clients.pop(client_id, None)

    def handle_get_week(self, path):
        week_id = path.split('/api/weeks/')[1]
        data = load_data()
        week = data["weeks"].get(week_id, create_empty_week(week_id))

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(week, ensure_ascii=False).encode('utf-8'))

    def handle_put_week(self, path):
        week_id = path.split('/api/weeks/')[1]
        client_id = self.headers.get('X-Client-Id', '')
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        week_data = json.loads(body)

        data = load_data()
        data["weeks"][week_id] = week_data
        save_data(data)

        broadcast({"weekId": week_id, "week": week_data}, exclude_client_id=client_id)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))

    def handle_get_stage(self):
        data = load_data()
        stage = data.get("stage", {"completedWeeks": []})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(stage, ensure_ascii=False).encode('utf-8'))

    def handle_put_stage(self):
        client_id = self.headers.get('X-Client-Id', '')
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        stage_data = json.loads(body)

        data = load_data()
        data["stage"] = stage_data
        save_data(data)

        broadcast_stage(stage_data, exclude_client_id=client_id)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode('utf-8'))


class ThreadedHTTPServer(HTTPServer):
    """Handle requests in separate threads for SSE support."""
    def process_request(self, request, client_address):
        thread = threading.Thread(target=self.process_request_thread, args=(request, client_address))
        thread.daemon = True
        thread.start()

    def process_request_thread(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


if __name__ == '__main__':
    server = ThreadedHTTPServer(('0.0.0.0', PORT), BILAHandler)
    print(f"BILA Dimitri-Miquel draait op http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer gestopt.")
        server.server_close()
