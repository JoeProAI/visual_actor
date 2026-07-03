"""Add a procedural `jawOpen` morph target to a static head GLB.

Tripo3D text-to-model heads ship as a single static mesh with no rig or
blendshapes, so the avatar's mouth can't move. This script synthesizes a
jaw-open morph by rotating lower-face vertices around an estimated jaw hinge
(ear line), with a smooth falloff, and appends it to the GLB as a morph
target named ``jawOpen`` — which the web renderer already knows how to drive
from the live audio envelope.

Assumes the Tripo3D convention: face looks along +X, up is +Y.

Usage:
    python scripts/add_jaw_morph.py [--model PATH] [--angle DEG]
        [--mouth-frac F] [--out PATH]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from pygltflib import GLTF2, Accessor, Buffer, BufferView, FLOAT, VEC3

DEFAULT_MODEL = Path(__file__).resolve().parents[1] / "app" / "assets" / "models" / "avatar_head.glb"


def read_positions(gltf: GLTF2, accessor_idx: int) -> np.ndarray:
    acc = gltf.accessors[accessor_idx]
    view = gltf.bufferViews[acc.bufferView]
    blob = gltf.binary_blob()
    start = (view.byteOffset or 0) + (acc.byteOffset or 0)
    data = np.frombuffer(blob, dtype=np.float32, count=acc.count * 3, offset=start)
    return data.reshape(-1, 3).astype(np.float64)


def jaw_delta(pos: np.ndarray, angle_deg: float, mouth_frac: float) -> np.ndarray:
    """Displacement that rotates the lower face down around the ear line (Z axis)."""
    x, y = pos[:, 0], pos[:, 1]
    y_min, y_max = y.min(), y.max()
    x_min, x_max = x.min(), x.max()

    nose_i = int(np.argmax(x))
    nose_y = y[nose_i]
    head_h = y_max - nose_y  # nose-to-crown, a stable proportional unit
    mouth_y = nose_y - mouth_frac * head_h
    chin_y = mouth_y - 0.9 * (nose_y - mouth_y)

    # Jaw hinge: at mouth height, roughly under the ears (mid-depth of head).
    pivot_x = x_min + 0.45 * (x_max - x_min)
    pivot_y = mouth_y + 0.15 * head_h

    # Region weight: forward of the hinge, below the mouth line, fading to 0
    # at the mouth line (upper lip stays put) and past the chin/neck.
    fwd = np.clip((x - pivot_x) / (x_max - pivot_x + 1e-9), 0.0, 1.0)
    below = np.clip((mouth_y - y) / (mouth_y - chin_y + 1e-9), 0.0, 1.0)
    neck_fade = np.clip((y - (chin_y - 0.6 * (mouth_y - chin_y))) / (0.6 * (mouth_y - chin_y) + 1e-9), 0.0, 1.0)
    w = (fwd ** 1.5) * np.minimum(below * 2.0, 1.0) * neck_fade

    theta = np.radians(angle_deg) * w
    dx = x - pivot_x
    dy = y - pivot_y
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    # Rotate around +Z so the chin (front, below pivot) swings down/back.
    new_x = pivot_x + dx * cos_t - dy * sin_t
    new_y = pivot_y + dx * sin_t + dy * cos_t

    delta = np.zeros_like(pos)
    delta[:, 0] = new_x - x
    delta[:, 1] = new_y - y
    return delta


def append_morph(gltf: GLTF2, delta: np.ndarray, name: str) -> None:
    blob = gltf.binary_blob()
    payload = delta.astype(np.float32).tobytes()
    pad = (-len(blob)) % 4
    offset = len(blob) + pad
    gltf.set_binary_blob(blob + b"\x00" * pad + payload)

    gltf.bufferViews.append(BufferView(buffer=0, byteOffset=offset, byteLength=len(payload)))
    gltf.accessors.append(
        Accessor(
            bufferView=len(gltf.bufferViews) - 1,
            componentType=FLOAT,
            count=len(delta),
            type=VEC3,
            max=delta.max(axis=0).astype(np.float32).tolist(),
            min=delta.min(axis=0).astype(np.float32).tolist(),
        )
    )
    acc_idx = len(gltf.accessors) - 1

    mesh = gltf.meshes[0]
    prim = mesh.primitives[0]
    prim.targets = (prim.targets or []) + [{"POSITION": acc_idx}]
    mesh.weights = (mesh.weights or []) + [0.0]
    extras = mesh.extras or {}
    extras["targetNames"] = extras.get("targetNames", []) + [name]
    mesh.extras = extras
    gltf.buffers[0].byteLength = len(gltf.binary_blob())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--out", type=Path, default=None, help="default: overwrite --model")
    parser.add_argument("--angle", type=float, default=10.0, help="max jaw-open rotation in degrees")
    parser.add_argument("--mouth-frac", type=float, default=0.22, help="mouth line below nose tip, as a fraction of nose-to-crown height")
    args = parser.parse_args()
    out = args.out or args.model

    gltf = GLTF2().load_binary(str(args.model))
    mesh = gltf.meshes[0]
    names = (mesh.extras or {}).get("targetNames", [])
    if "jawOpen" in names:
        print("model already has a jawOpen morph; nothing to do")
        return 0

    pos = read_positions(gltf, mesh.primitives[0].attributes.POSITION)
    delta = jaw_delta(pos, args.angle, args.mouth_frac)
    moved = int((np.abs(delta).sum(axis=1) > 1e-6).sum())
    print(f"vertices: {len(pos)}, displaced: {moved}, max |delta|: {np.abs(delta).max():.4f}")
    append_morph(gltf, delta, "jawOpen")
    gltf.save_binary(str(out))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
