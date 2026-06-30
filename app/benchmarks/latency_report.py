"""Latency report rendering: JSON + human-readable table + PASS/FAIL verdict."""

from __future__ import annotations

import json
import platform
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Verdict:
    passed: bool
    bottleneck: str | None


def build_report(
    config_budget: dict[str, float],
    runs: list[dict[str, Any]],
    frame_summary: dict[str, float],
    resources: dict[str, float | None],
    rainmeter_overhead_ms: float | None,
) -> dict[str, Any]:
    """Aggregate per-run grades into a single report dict."""
    # Average each metric across runs (ignoring missing values).
    metrics: dict[str, dict[str, Any]] = {}
    for run in runs:
        for name, info in run["grade"].items():
            slot = metrics.setdefault(name, {"values": [], "target": info["target"], "pass": True})
            if info["value"] is not None:
                slot["values"].append(info["value"])
            if info["pass"] is False:
                slot["pass"] = False

    summary: dict[str, Any] = {}
    worst_margin = -1e9
    bottleneck: str | None = None
    for name, slot in metrics.items():
        vals = slot["values"]
        avg = sum(vals) / len(vals) if vals else None
        passed = slot["pass"]
        summary[name] = {"avg": avg, "target": slot["target"], "pass": passed}
        if avg is not None and name != "audio_mouth_sync_offset_ms":
            margin = avg - slot["target"]  # positive => over budget
            if not passed and margin > worst_margin:
                worst_margin = margin
                bottleneck = name

    # FPS pass against min_fps
    fps = frame_summary.get("avg_fps", 0.0)
    fps_pass = fps >= config_budget.get("min_fps", 30)
    summary["avg_fps"] = {"avg": fps, "target": config_budget.get("min_fps", 30), "pass": fps_pass}
    if not fps_pass and bottleneck is None:
        bottleneck = "avg_fps"

    overall = all(m["pass"] for m in summary.values())
    return {
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "budget": config_budget,
        "metrics": summary,
        "frames": frame_summary,
        "resources": resources,
        "rainmeter_webview_overhead_ms": rainmeter_overhead_ms,
        "runs": runs,
        "verdict": {"passed": overall, "bottleneck": None if overall else bottleneck},
    }


def render_table(report: dict[str, Any]) -> str:
    """Render the report as a fixed-width text table with a PASS/FAIL verdict."""
    lines: list[str] = []
    lines.append("=" * 68)
    lines.append("VISUAL ACTOR — LATENCY BENCHMARK REPORT")
    lines.append("=" * 68)
    p = report["platform"]
    lines.append(f"Platform : {p['system']} {p['release']} ({p['machine']}) py{p['python']}")
    lines.append("-" * 68)
    lines.append(f"{'METRIC':<34}{'VALUE':>10}{'TARGET':>12}{'RESULT':>10}")
    lines.append("-" * 68)
    for name, m in report["metrics"].items():
        val = m["avg"]
        val_s = "n/a" if val is None else f"{val:.2f}"
        tgt = m["target"]
        res = "PASS" if m["pass"] else "FAIL"
        lines.append(f"{name:<34}{val_s:>10}{tgt:>12.2f}{res:>10}")
    lines.append("-" * 68)
    fr = report["frames"]
    lines.append(
        f"FPS avg={fr.get('avg_fps', 0):.1f}  "
        f"p50={fr.get('p50_ms', 0):.2f}ms p95={fr.get('p95_ms', 0):.2f}ms "
        f"p99={fr.get('p99_ms', 0):.2f}ms jitter={fr.get('jitter_ms', 0):.2f}ms"
    )
    rs = report["resources"]
    lines.append(
        f"CPU avg={_fmt(rs.get('cpu_avg_pct'))}% max={_fmt(rs.get('cpu_max_pct'))}%  "
        f"MEM avg={_fmt(rs.get('mem_avg_mb'))}MB  "
        f"GPU avg={_fmt(rs.get('gpu_avg_pct'))}%"
    )
    ovh = report.get("rainmeter_webview_overhead_ms")
    lines.append(f"Rainmeter WebView2 overhead: {_fmt(ovh)} ms")
    lines.append("=" * 68)
    v = report["verdict"]
    if v["passed"]:
        lines.append("VERDICT: PASS — within latency budget")
    else:
        lines.append(f"VERDICT: FAIL — bottleneck: {v['bottleneck']}")
    lines.append("=" * 68)
    return "\n".join(lines)


def _fmt(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.1f}"


def write_reports(report: dict[str, Any], json_path: str, txt_path: str) -> None:
    Path(json_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
    Path(txt_path).write_text(render_table(report), encoding="utf-8")
