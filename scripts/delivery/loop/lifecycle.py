"""Interruptible scheduling waits for the existing loop owner."""
from contextlib import contextmanager
from pathlib import Path
import signal
import threading
import time

IDLE_SECONDS = 180
ACTIVE_SECONDS = 30


class Lifecycle:
    def __init__(self, directory):
        self.stop_file = Path(directory) / 'STOP'
        self.reason = None
        self.wake = threading.Event()

    def stopping(self):
        if self.reason is None and self.stop_file.exists():
            self.reason = 'stop file: ' + str(self.stop_file)
        return self.reason is not None

    def _signal(self, number, frame):
        if self.reason is None:
            self.reason = signal.Signals(number).name
        self.wake.set()

    @contextmanager
    def signals(self):
        previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
        try:
            for number in previous:
                signal.signal(number, self._signal)
            yield self
        finally:
            for number, handler in previous.items():
                signal.signal(number, handler)

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while not self.stopping():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            # Stop files are noticed within one second; signals wake immediately.
            self.wake.wait(min(remaining, 1))
