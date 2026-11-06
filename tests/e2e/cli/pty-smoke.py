"""Exercise the installed executable through an actual terminal; no network."""

import errno
import json
import os
import pty
import select
import subprocess
import sys
import termios
import time


master, slave = pty.openpty()
before = termios.tcgetattr(slave)
child = subprocess.Popen(
    [sys.argv[1], "tui"], stdin=slave, stdout=slave, stderr=slave, close_fds=True
)
captured = bytearray()
cancel_sent = False
try:
    deadline = time.monotonic() + 10
    while child.poll() is None and time.monotonic() < deadline:
        readable, _, _ = select.select([master], [], [], 0.05)
        if readable:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            captured.extend(chunk)
        # Wait for raw mode, so Ctrl-C reaches the Node handler rather than a
        # controlling-terminal signal whose behavior depends on the runner.
        if not cancel_sent and not termios.tcgetattr(slave)[3] & termios.ICANON:
            os.write(master, b"\x03")
            cancel_sent = True
    if child.poll() is None:
        raise RuntimeError("Terminal cancellation did not complete")
    while select.select([master], [], [], 0.05)[0]:
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        captured.extend(chunk)
    print(json.dumps({
        "exitCode": child.wait(),
        "cancelSent": cancel_sent,
        "terminalRestored": termios.tcgetattr(slave) == before,
        "cursorRestored": b"\x1b[?25h" in captured,
        "rendered": b"Monolith" in captured,
    }))
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
    os.close(slave)
