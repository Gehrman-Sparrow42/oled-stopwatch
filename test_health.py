import socketserver
import threading
import urllib.request
from server import Handler

def test_health():
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        req = urllib.request.urlopen(base_url + "/", timeout=5)
        status = req.status
        content = req.read().decode("utf-8")
        assert status == 200, f"Expected 200, got {status}"
        assert "CHRONO FOCUS" in content, "CHRONO FOCUS not found in HTML"
        assert "styles.css" in content, "styles.css not found in HTML"
        assert "app.js" in content, "app.js not found in HTML"

        # Check styles.css
        css_req = urllib.request.urlopen(base_url + "/styles.css", timeout=5)
        assert css_req.status == 200
        css_content = css_req.read().decode("utf-8")
        assert "#000000" in css_content

        # Check app.js
        js_req = urllib.request.urlopen(base_url + "/app.js", timeout=5)
        assert js_req.status == 200
        js_content = js_req.read().decode("utf-8")
        assert "ChronoStopwatch" in js_content

        # Check worker.js
        worker_req = urllib.request.urlopen(base_url + "/worker.js", timeout=5)
        assert worker_req.status == 200
        core_req = urllib.request.urlopen(base_url + "/core.js", timeout=5)
        assert core_req.status == 200
        assert "core.js" in content
        assert "fonts.googleapis.com" not in content

        print("HEALTH CHECK PASSED: 200 OK for root and all assets!")
    finally:
        server.shutdown()
        server.server_close()
        t.join(timeout=5)

if __name__ == "__main__":
    test_health()
