"""Serve and record the browser probe on IPv4 loopback."""

import argparse
import json
import re
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlencode, urlsplit

DIRECTORY = Path(__file__).resolve().parent
HEADERS = (
    "User-Agent", "Accept-Language", "Sec-CH-UA", "Sec-CH-UA-Mobile",
    "Sec-CH-UA-Platform", "Sec-CH-UA-Full-Version-List",
    "Sec-CH-UA-Platform-Version", "Sec-CH-UA-Arch", "Sec-CH-UA-Bitness",
)
DEFAULT_FONTS = [
    "Arial", "Helvetica", "Times New Roman", "Courier New", "Verdana", "Tahoma",
    "Georgia", "Impact", "Avenir", "Menlo", "Monaco", "American Typewriter",
    "Apple Color Emoji", "Baskerville", "Comic Sans MS", "Wingdings", "Papyrus",
    "Futura", "Chalkboard", "PingFang SC", "Hiragino Sans", "STHeiti", "Noto Sans CJK SC",
]
FORM = r"""
<form action="/start">
    <p><label>实验标签 <input name="run" required pattern="[A-Za-z0-9_\-]{1,64}"></label></p>
    <p><label>页面采样次数 <input name="count" type="number" min="1" max="20" value="3" required></label></p>
    <p><label>WebGL 绘制
        <select name="drawing"><option value="shader">着色器</option><option value="clear">分段清屏</option></select>
    </label></p>
    <p><label><input type="checkbox" name="locate" value="1"> 发送定位请求</label></p>
    <p><label><input type="checkbox" name="storage" value="1"> 写入并读取本机测试存储</label></p>
    <button>开始采样</button>
</form>
<p><a href="/cleanup">清除本机测试存储</a></p>
"""


class ProbeServer(ThreadingHTTPServer):
    def __init__(self, port, output, fonts):
        super().__init__(("127.0.0.1", port), Handler)
        self.output = output
        self.fonts = fonts
        self.script = (DIRECTORY / "probe.js").read_bytes()
        self.token = secrets.token_hex(16)
        self.cookie = f"adspower_probe_{self.token}"
        self.primary = f"127.0.0.1:{self.server_port}"
        self.secondary = f"localhost:{self.server_port}"
        self.batches = {}
        self.lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def reply(self, code, kind, body, *, location=None):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Accept-CH", ", ".join(HEADERS[5:]))
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
            "connect-src 'self'; worker-src 'self'; "
            f"frame-src 'self' http://{self.server.secondary}; "
            f"frame-ancestors 'self' http://{self.server.primary}; "
            "base-uri 'none'; form-action 'self'",
        )
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(body)

    def json_reply(self, payload, code=200):
        self.reply(code, "application/json", json.dumps(payload, ensure_ascii=False).encode())

    def page(self, content, *, script=False, frame=False):
        document = (
            '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<meta name="probe-token" content="{self.server.token}">'
            '<title>AdsPower 本机指纹实验</title>'
            '<body>'
            + ('' if frame else '<h1>AdsPower 本机指纹实验</h1>')
            + content
            + ('<script defer src="/probe.js"></script>' if script else '')
            + '</body></html>'
        )
        self.reply(200, "text/html; charset=utf-8", document.encode())

    def do_GET(self):
        host = self.headers.get("Host")
        if host not in (self.server.primary, self.server.secondary):
            self.json_reply({"error": "Unexpected host"}, 400)
            return
        url = urlsplit(self.path)
        if url.path in ("/", "/start", "/sample", "/cleanup") and host != self.server.primary:
            self.reply(303, "text/plain", b"", location=f"http://{self.server.primary}/")
        elif url.path == "/":
            self.page(FORM)
        elif url.path == "/start":
            self.start_batch(parse_qs(url.query))
        elif url.path == "/sample":
            self.page('<p id="status" role="status">正在采样…</p><p><a href="/">返回实验设置</a></p>', script=True)
        elif url.path == "/frame":
            self.page("", script=True, frame=True)
        elif url.path == "/cleanup":
            self.page('<p id="status" role="status"></p><p><a href="/">返回实验设置</a></p>', script=True)
        elif url.path == "/probe.js":
            self.reply(200, "text/javascript; charset=utf-8", self.server.script)
        elif url.path == "/fonts":
            self.json_reply(self.server.fonts)
        elif url.path == "/headers":
            headers = {name: self.headers.get(name) for name in HEADERS}
            headers["testCookiePresent"] = any(
                item.strip() == f"{self.server.cookie}=1"
                for item in self.headers.get("Cookie", "").split(";")
            )
            self.json_reply(headers)
        else:
            self.json_reply({"error": "Unknown path"}, 404)

    def start_batch(self, parameters):
        def get(name, default=""):
            return parameters.get(name, [default])[0]

        run = get("run")
        count = get("count", "3")
        drawing = get("drawing", "shader")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run) or count not in map(str, range(1, 21)):
            self.json_reply({"error": "Invalid run label or sample count"}, 400)
            return
        if drawing not in ("shader", "clear"):
            self.json_reply({"error": "Unknown WebGL drawing mode"}, 400)
            return
        settings = {
            "run": run, "count": int(count), "drawing": drawing,
            "locate": get("locate") == "1", "storage": get("storage") == "1",
        }
        batch = secrets.token_hex(8)
        with self.server.lock:
            self.server.batches[batch] = settings
        query = urlencode({
            "batch": batch, "index": 1, "run": run, "count": count, "drawing": drawing,
            "locate": int(settings["locate"]), "storage": int(settings["storage"]),
        })
        self.reply(303, "text/plain", b"", location=f"/sample?{query}")

    def do_POST(self):
        if self.path != "/report":
            self.json_reply({"error": "Unknown path"}, 404)
            return
        if (self.headers.get("Host") != self.server.primary
                or self.headers.get("Origin") != f"http://{self.server.primary}"):
            self.json_reply({"error": "Unexpected origin"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 512_000:
                raise ValueError
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or data.get("token") != self.server.token:
                raise ValueError
            batch = data["batch"]
            index = data["index"]
            readings = data["readings"]
            if not isinstance(batch, str) or type(index) is not int or not isinstance(readings, dict):
                raise ValueError
        except (ValueError, KeyError, UnicodeError):
            self.json_reply({"error": "Invalid report"}, 400)
            return
        try:
            with self.server.lock:
                settings = self.server.batches.get(batch)
                if settings is None or not 1 <= index <= settings["count"]:
                    self.json_reply({"error": "Unknown sample. Start a new batch."}, 400)
                    return
                row = {"schema": 1, "batch": batch, "index": index, **settings, "readings": readings}
                with self.server.output.open("a", encoding="utf-8") as output:
                    output.write(json.dumps(row, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n")
        except ValueError:
            self.json_reply({"error": "Invalid report values"}, 400)
            return
        except OSError:
            self.json_reply({"error": "Failed to write the output file"}, 500)
            return
        self.json_reply({"ok": True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="JSONL file to append to")
    parser.add_argument("--port", type=int, default=0, help="loopback port, 0 chooses a free port")
    parser.add_argument("--fonts", type=Path, help="optional JSON array of font family names")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    try:
        fonts = DEFAULT_FONTS
        if args.fonts:
            fonts = json.loads(args.fonts.read_text(encoding="utf-8"))
            if not isinstance(fonts, list) or not fonts or not all(
                isinstance(name, str) and name.strip() for name in fonts
            ):
                parser.error("fonts must be a nonempty JSON array of font family names")
            fonts = list(dict.fromkeys(fonts))
        with args.output.open("a", encoding="utf-8"):
            pass
        with ProbeServer(args.port, args.output, fonts) as server:
            print(f"http://{server.primary}/", flush=True)
            server.serve_forever()
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
