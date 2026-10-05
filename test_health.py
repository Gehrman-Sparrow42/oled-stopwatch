import http.server
import socketserver
import os
import threading
import urllib.request
import time

def test_health():
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=web_dir, **kwargs)
        def log_message(self, *args):
            pass

    server = socketserver.TCPServer(("127.0.0.1", 8112), Handler)
    server.allow_reuse_address = True
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    time.sleep(0.5)

    try:
        req = urllib.request.urlopen("http://127.0.0.1:8112/")
        status = req.status
        content = req.read().decode("utf-8")
        assert status == 200, f"Expected 200, got {status}"
        assert "CHRONO OLED" in content, "CHRONO OLED not found in HTML"
        assert "styles.css" in content, "styles.css not found in HTML"
        assert "app.js" in content, "app.js not found in HTML"

        # Check styles.css
        css_req = urllib.request.urlopen("http://127.0.0.1:8112/styles.css")
        assert css_req.status == 200
        css_content = css_req.read().decode("utf-8")
        assert "#000000" in css_content

        # Check app.js
        js_req = urllib.request.urlopen("http://127.0.0.1:8112/app.js")
        assert js_req.status == 200
        js_content = js_req.read().decode("utf-8")
        assert "ChronoStopwatch" in js_content

        # Check worker.js
        worker_req = urllib.request.urlopen("http://127.0.0.1:8112/worker.js")
        assert worker_req.status == 200

        print("HEALTH CHECK PASSED: 200 OK for root and all assets!")
    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    test_health()
