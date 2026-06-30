"""System + frame metrics collection for benchmarking.

Samples CPU / memory (and GPU if available) over a run and computes frame-time
statistics (FPS, p50/p95/p99, jitter) from per-frame deltas.
"""

from __future__ import annotations

import shutil
import statistics
import subprocess
import threading
import time
from dataclasses import dataclass, field

import psutil


@dataclass
class FrameStats:
    avg_fps: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    jitter_ms: float
    frame_count: int


def frame_stats(frame_times_ms: list[float]) -> FrameStats:
    """Compute FPS and percentile/jitter stats from per-frame deltas (ms)."""
    valid = [t for t in frame_times_ms if t > 0]
    if not valid:
        return FrameStats(0.0, 0.0, 0.0, 0.0, 0.0, 0)
    s = sorted(valid)

    def pct(p: float) -> float:
        idx = min(len(s) - 1, int(round(p / 100.0 * (len(s) - 1))))
        return s[idx]

    mean = statistics.fmean(valid)
    jitter = statistics.pstdev(valid) if len(valid) > 1 else 0.0
    return FrameStats(
        avg_fps=1000.0 / mean if mean > 0 else 0.0,
        p50_ms=pct(50),
        p95_ms=pct(95),
        p99_ms=pct(99),
        jitter_ms=jitter,
        frame_count=len(valid),
    )


def _gpu_usage() -> float | None:
    """Return GPU utilization % via nvidia-smi if present, else None."""
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=2.0,
        )
        vals = [float(x) for x in out.stdout.split() if x.strip().replace(".", "").isdigit()]
        return statistics.fmean(vals) if vals else None
    except Exception:
        return None


@dataclass
class ResourceSampler:
    """Background sampler for CPU / memory / GPU usage."""

    interval_s: float = 0.1
    cpu: list[float] = field(default_factory=list)
    mem_mb: list[float] = field(default_factory=list)
    gpu: list[float] = field(default_factory=list)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def __enter__(self) -> ResourceSampler:
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    def start(self) -> None:
        proc = psutil.Process()
        proc.cpu_percent(None)  # prime

        def _run() -> None:
            while not self._stop.is_set():
                self.cpu.append(proc.cpu_percent(None))
                self.mem_mb.append(proc.memory_info().rss / (1024 * 1024))
                g = _gpu_usage()
                if g is not None:
                    self.gpu.append(g)
                time.sleep(self.interval_s)

        self._thread = threading.Thread(target=_run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)

    def summary(self) -> dict[str, float | None]:
        def avg(x: list[float]) -> float | None:
            return statistics.fmean(x) if x else None

        def mx(x: list[float]) -> float | None:
            return max(x) if x else None

        return {
            "cpu_avg_pct": avg(self.cpu),
            "cpu_max_pct": mx(self.cpu),
            "mem_avg_mb": avg(self.mem_mb),
            "mem_max_mb": mx(self.mem_mb),
            "gpu_avg_pct": avg(self.gpu),
            "gpu_max_pct": mx(self.gpu),
        }
