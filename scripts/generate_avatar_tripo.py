"""Generate a realistic 3D avatar head with the Tripo3D API.

Requires TRIPO3D_API_KEY in the environment. Downloads the resulting GLB to
app/assets/models/avatar_head.glb, which the web frontend picks up
automatically for the 3D face mode.

Usage:
    python scripts/generate_avatar_tripo.py [--prompt "..."] [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

API_BASE = "https://api.tripo3d.ai/v2/openapi"
DEFAULT_PROMPT = (
    "Photorealistic portrait bust of a friendly young woman, head and "
    "shoulders, neutral relaxed expression, mouth closed, realistic skin "
    "texture, natural dark hair, symmetrical face, facing straight forward, "
    "studio lighting, high detail"
)
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "app" / "assets" / "models" / "avatar_head.glb"
POLL_INTERVAL_S = 5
TIMEOUT_S = 900


def _request(method: str, url: str, api_key: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode())
    if body.get("code") != 0:
        raise RuntimeError(f"Tripo3D API error: {body}")
    return body["data"]


def _extract_model_url(output: dict) -> str | None:
    for key in ("pbr_model", "model", "base_model"):
        value = output.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, dict) and value.get("url"):
            return value["url"]
    return None


def _wait_task(task_id: str, api_key: str) -> dict:
    deadline = time.monotonic() + TIMEOUT_S
    while True:
        if time.monotonic() > deadline:
            raise TimeoutError(f"Task {task_id} did not finish within {TIMEOUT_S}s")
        info = _request("GET", f"{API_BASE}/task/{task_id}", api_key)
        status = info.get("status")
        progress = info.get("progress", 0)
        print(f"  status={status} progress={progress}%")
        if status == "success":
            return info
        if status in ("failed", "cancelled", "banned", "expired"):
            raise RuntimeError(f"Task {task_id} ended with status {status}: {info}")
        time.sleep(POLL_INTERVAL_S)


def _download(url: str, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading model to {out_path}…")
    urllib.request.urlretrieve(url, out_path)
    size_mb = out_path.stat().st_size / 1e6
    print(f"Done ({size_mb:.1f} MB)")
    return out_path


def generate(prompt: str, out_path: Path, api_key: str, rig: bool = False) -> Path:
    print(f"Submitting text_to_model task…\n  prompt: {prompt}")
    task = _request(
        "POST",
        f"{API_BASE}/task",
        api_key,
        {"type": "text_to_model", "prompt": prompt, "model_version": "v2.5-20250123"},
    )
    task_id = task["task_id"]
    print(f"  task_id: {task_id}")

    info = _wait_task(task_id, api_key)
    output = info.get("output") or info.get("result") or {}
    url = _extract_model_url(output)
    if not url:
        raise RuntimeError(f"No model URL in task output: {output}")

    if rig:
        try:
            return rig_model(task_id, out_path, api_key)
        except Exception as exc:
            print(f"Rigging failed ({exc}); falling back to unrigged model", file=sys.stderr)

    return _download(url, out_path)


def rig_model(model_task_id: str, out_path: Path, api_key: str) -> Path:
    """Run Tripo3D's pre-rig check + auto-rig on an existing model task."""
    print("Submitting animate_prerigcheck task…")
    check = _request(
        "POST",
        f"{API_BASE}/task",
        api_key,
        {"type": "animate_prerigcheck", "original_model_task_id": model_task_id},
    )
    check_info = _wait_task(check["task_id"], api_key)
    riggable = (check_info.get("output") or {}).get("riggable")
    print(f"  riggable: {riggable}")
    if not riggable:
        raise RuntimeError("Tripo3D pre-rig check reports the model is not riggable")

    print("Submitting animate_rig task…")
    rig = _request(
        "POST",
        f"{API_BASE}/task",
        api_key,
        {
            "type": "animate_rig",
            "original_model_task_id": model_task_id,
            "out_format": "glb",
        },
    )
    rig_info = _wait_task(rig["task_id"], api_key)
    output = rig_info.get("output") or rig_info.get("result") or {}
    url = _extract_model_url(output)
    if not url:
        raise RuntimeError(f"No model URL in rig task output: {output}")
    return _download(url, out_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--rig", action="store_true", help="auto-rig the model (jaw/skeleton) after generation")
    parser.add_argument("--rig-task", help="skip generation; rig an existing model task id")
    args = parser.parse_args()

    api_key = os.environ.get("TRIPO3D_API_KEY", "")
    if not api_key:
        print("TRIPO3D_API_KEY is not set", file=sys.stderr)
        return 1
    if args.rig_task:
        rig_model(args.rig_task, args.out, api_key)
    else:
        generate(args.prompt, args.out, api_key, rig=args.rig)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
