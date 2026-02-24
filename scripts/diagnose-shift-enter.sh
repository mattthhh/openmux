#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

python3 - <<'PY'
import datetime
import os
import platform
import select
import shutil
import subprocess
import sys
import termios
import tty
from typing import Optional


def run_cmd(cmd: list[str]) -> str:
    try:
        return subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True, timeout=5).strip()
    except Exception as e:
        return f"<error: {e}>"


def run_cmd_with_stdin_fd(cmd: list[str], fd: int) -> str:
    try:
        with os.fdopen(os.dup(fd), "rb", closefd=True) as stdin_file:
            return subprocess.check_output(
                cmd,
                stdin=stdin_file,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=5,
            ).strip()
    except Exception as e:
        return f"<error: {e}>"


def byte_escape(data: bytes) -> str:
    pieces: list[str] = []
    for b in data:
        if b == 0x1B:
            pieces.append("\\e")
        elif b == 0x0D:
            pieces.append("\\r")
        elif b == 0x0A:
            pieces.append("\\n")
        elif b == 0x09:
            pieces.append("\\t")
        elif 32 <= b <= 126:
            pieces.append(chr(b))
        else:
            pieces.append(f"\\x{b:02x}")
    return "".join(pieces)


def byte_hex(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data)


def classify(data: bytes) -> str:
    known = {
        b"\r": "CR (Enter)",
        b"\n": "LF (Enter/Newline)",
        b"\x1b\r": "ESC+CR (often Alt+Enter, sometimes remapped Shift+Enter)",
        b"\x1b\n": "ESC+LF (often remapped Shift+Enter; can break pi newline)",
        b"\x1b[13u": "Kitty CSI-u Enter",
        b"\x1b[13;2u": "Kitty CSI-u Shift+Enter",
        b"\x1b[13;3u": "Kitty CSI-u Alt+Enter",
        b"\x1b[13;5u": "Kitty CSI-u Ctrl+Enter",
        b"\x1b[27;2;13~": "xterm modifyOtherKeys Shift+Enter",
        b"\x1b[27;3;13~": "xterm modifyOtherKeys Alt+Enter",
        b"\x1b[27;5;13~": "xterm modifyOtherKeys Ctrl+Enter",
    }
    if data in known:
        return known[data]
    if data.startswith(b"\x1b[") and data.endswith(b"u"):
        return "CSI-u keyboard protocol sequence"
    if data.startswith(b"\x1b[27;") and data.endswith(b"~"):
        return "xterm modifyOtherKeys sequence"
    if data.startswith(b"\x1b"):
        return "ESC-prefixed sequence"
    return "unknown/plain"


class Logger:
    def __init__(self, path: str, console_fd: Optional[int] = None):
        self._f = open(path, "w", encoding="utf-8")
        self._console_fd = console_fd

    def log(self, line: str = "") -> None:
        if self._console_fd is not None:
            os.write(self._console_fd, (line + "\n").encode("utf-8", errors="replace"))
        else:
            print(line, flush=True)
        self._f.write(line + "\n")
        self._f.flush()

    def close(self) -> None:
        self._f.close()


class RawReader:
    def __init__(self, fd: int):
        self.fd = fd
        self.original = termios.tcgetattr(fd)

    def __enter__(self):
        tty.setraw(self.fd, when=termios.TCSANOW)
        return self

    def __exit__(self, exc_type, exc, tb):
        termios.tcsetattr(self.fd, termios.TCSANOW, self.original)

    def read_burst(self, first_timeout: float = 12.0, idle_timeout: float = 0.18, max_bytes: int = 128) -> bytes:
        r, _, _ = select.select([self.fd], [], [], first_timeout)
        if not r:
            return b""

        data = bytearray(os.read(self.fd, 1))
        while len(data) < max_bytes:
            r, _, _ = select.select([self.fd], [], [], idle_timeout)
            if not r:
                break
            chunk = os.read(self.fd, max_bytes - len(data))
            if not chunk:
                break
            data.extend(chunk)
        return bytes(data)


KITTY_ENABLE_PI = "\x1b[>7u"
KITTY_DISABLE = "\x1b[<u"


def send_stdout(fd: int, seq: str) -> None:
    os.write(fd, seq.encode("utf-8", errors="ignore"))


def prompt_and_capture(reader: RawReader, logger: Logger, label: str) -> Optional[bytes]:
    logger.log(f"  • {label}: press now...")
    data = reader.read_burst()
    if not data:
        logger.log("    result: <timeout>")
        return None
    if data == b"\x03":
        raise KeyboardInterrupt()

    logger.log(f"    bytes  : {byte_hex(data)}")
    logger.log(f"    escaped: {byte_escape(data)}")
    logger.log(f"    class  : {classify(data)}")
    return data


def main() -> int:
    tty_fd: Optional[int] = None
    in_fd: Optional[int] = sys.stdin.fileno() if sys.stdin.isatty() else None
    out_fd: Optional[int] = sys.stdout.fileno() if sys.stdout.isatty() else None
    logger: Optional[Logger] = None

    if in_fd is None or out_fd is None:
        try:
            tty_fd = os.open("/dev/tty", os.O_RDWR)
        except OSError:
            print(
                "Unable to access an interactive TTY. Try running directly in a local terminal.",
                file=sys.stderr,
            )
            return 1

        if in_fd is None:
            in_fd = tty_fd
        if out_fd is None:
            out_fd = tty_fd

    assert in_fd is not None
    assert out_fd is not None

    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = os.path.abspath(f"shift-enter-diagnostic-{timestamp}.log")
    logger = Logger(report_path, console_fd=out_fd)

    try:
        logger.log("=== Shift+Enter Diagnostic Report ===")
        logger.log(f"time: {datetime.datetime.now().isoformat()}")
        logger.log(f"report: {report_path}")
        logger.log("")

        logger.log("=== Environment ===")
        logger.log(f"platform: {platform.platform()}")
        logger.log(f"python: {platform.python_version()}")
        logger.log(f"shell: {os.environ.get('SHELL', '<unset>')}")
        for key in [
            "TERM",
            "TERM_PROGRAM",
            "TERM_PROGRAM_VERSION",
            "COLORTERM",
            "LANG",
            "LC_ALL",
            "KITTY_WINDOW_ID",
            "WEZTERM_PANE",
            "TMUX",
            "ZELLIJ",
        ]:
            logger.log(f"env[{key}]={os.environ.get(key, '<unset>')}")

        logger.log("")
        logger.log("=== Tool Versions ===")
        logger.log(f"stty -a: {run_cmd_with_stdin_fd(['stty', '-a'], in_fd)}")
        logger.log(f"infocmp -x: {run_cmd(['infocmp', '-x'])[:1200]}")

        pi_path = shutil.which("pi")
        logger.log(f"pi path: {pi_path or '<not found>'}")
        if pi_path:
            logger.log(f"pi --version: {run_cmd(['pi', '--version'])}")

        logger.log("")
        logger.log("=== Capture Instructions ===")
        logger.log("Press each combo exactly once when prompted.")
        logger.log("Ctrl+C aborts and restores terminal settings.")
        logger.log("")

        with RawReader(in_fd) as reader:
            # Start from known state
            send_stdout(out_fd, KITTY_DISABLE)

            logger.log("--- Scenario A: Kitty keyboard DISABLED (ESC[<u) ---")
            prompt_and_capture(reader, logger, "Enter")
            prompt_and_capture(reader, logger, "Shift+Enter")
            prompt_and_capture(reader, logger, "Alt+Enter")
            prompt_and_capture(reader, logger, "Ctrl+Enter (if supported)")
            logger.log("")

            logger.log("--- Scenario B: Kitty keyboard ENABLED (pi flags via ESC[>7u) ---")
            send_stdout(out_fd, KITTY_ENABLE_PI)
            prompt_and_capture(reader, logger, "Enter")
            prompt_and_capture(reader, logger, "Shift+Enter")
            prompt_and_capture(reader, logger, "Alt+Enter")
            prompt_and_capture(reader, logger, "Ctrl+Enter")
            logger.log("")

            send_stdout(out_fd, KITTY_DISABLE)

            logger.log("--- Free Capture ---")
            logger.log("Press keys/chords to inspect raw bursts. Press q alone to finish.")
            while True:
                data = reader.read_burst(first_timeout=60.0)
                if not data:
                    logger.log("  (idle timeout; ending free capture)")
                    break
                if data == b"q":
                    logger.log("  received q, ending free capture")
                    break
                if data == b"\x03":
                    raise KeyboardInterrupt()
                logger.log(f"  burst bytes  : {byte_hex(data)}")
                logger.log(f"  burst escaped: {byte_escape(data)}")
                logger.log(f"  burst class  : {classify(data)}")

            send_stdout(out_fd, KITTY_DISABLE)

        logger.log("")
        logger.log("Done. Send this report file for analysis:")
        logger.log(report_path)
        return 0
    except KeyboardInterrupt:
        if logger:
            logger.log("\nInterrupted (Ctrl+C).")
        return 130
    finally:
        try:
            send_stdout(out_fd, KITTY_DISABLE)
        except Exception:
            pass
        if logger:
            logger.close()
        if tty_fd is not None:
            os.close(tty_fd)


if __name__ == "__main__":
    raise SystemExit(main())
PY
