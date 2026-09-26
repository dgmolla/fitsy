#!/usr/bin/env python3
"""Supervise an owned DB command and its descendants under one OS lock."""
import fcntl
import os
import signal
import subprocess
import sys
import time

if sys.argv[1:2] == ["--watch"]:
    # A worker killed with SIGKILL can leave test descendants alive. The
    # detached guardian keeps the shared lock until their group exits.
    group = int(sys.argv[2])
    while True:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    sys.exit(0)

root, executable, *command = sys.argv[1:]
directory = os.path.join(root, ".evidence", "verify")
os.makedirs(directory, mode=0o700, exist_ok=True)
fd = os.open(os.path.join(directory, "db.lock"), os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(75)
environment = dict(os.environ, FITSY_VERIFY_DB_LOCKED="1")
# The verification worker holds the same kernel lock. If this coordinator is
# killed, a live worker still prevents the next run from resetting its DB.
child = subprocess.Popen([executable, *command], env=environment, start_new_session=True, pass_fds=(fd,))
subprocess.Popen([sys.executable, __file__, "--watch", str(child.pid)], pass_fds=(fd,),
                 start_new_session=True, stdin=subprocess.DEVNULL,
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop_group(sig):
    try:
        os.killpg(child.pid, sig)
    except ProcessLookupError:
        pass


def interrupt(sig, _frame):
    stop_group(sig)


signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGTERM, interrupt)
status = child.wait()
# A crashed coordinator can leave migrations or tests running in its process
# group. Stop them before releasing the lock, so the next run cannot reset DB.
stop_group(signal.SIGTERM)
time.sleep(0.05)
stop_group(signal.SIGKILL)
sys.exit(status if status >= 0 else 128 - status)
