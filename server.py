import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8110
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Quiet down standard HTTP logs for a cleaner terminal
        pass

def run():
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}"
        print("=====================================================")
        print("   CHRONO OLED - High-Precision Browser Stopwatch    ")
        print(f"   Server Active: {url}                           ")
        print("=====================================================")
        print("Press Ctrl+C to terminate.")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    run()
