"""Direct frame renderer (default ``blendshape`` backend).

Generates RGB frames *directly* from blendshape weights using closed-form 2D
drawing / warping — **no diffusion, no latent sampling, no iterative denoising**.
Every frame is one deterministic pass of vectorized NumPy raster ops (and an
optional OpenCV affine warp of the avatar image when ``opencv-python`` is
installed). This is what makes sub-frame render latency possible on CPU.

The same blendshape frame is also serialized to JSON for the browser, which
renders an identical face on a ``<canvas>`` — so the web "live camera feed" and
the server-rendered MJPEG stream stay in lockstep.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import numpy as np

from app.avatar.blendshapes import Blendshapes
from app.config import AppConfig, AvatarDef


class Renderer(Protocol):
    """Renderer interface so backends are swappable in one config line."""

    width: int
    height: int

    def render(self, bs: Blendshapes) -> np.ndarray:
        """Return an (H, W, 3) uint8 RGB frame for the blendshape state."""
        ...


def _disk(h: int, w: int, cy: float, cx: float, ry: float, rx: float) -> np.ndarray:
    """Boolean mask of a filled ellipse (vectorized)."""
    yy, xx = np.ogrid[:h, :w]
    return ((yy - cy) / max(1e-6, ry)) ** 2 + ((xx - cx) / max(1e-6, rx)) ** 2 <= 1.0


class BlendshapeRenderer:
    """Procedural 2D talking-head renderer driven purely by blendshapes."""

    def __init__(self, config: AppConfig, avatar: AvatarDef) -> None:
        self.width = config.actor.width
        self.height = config.actor.height
        self.anchors = avatar.anchors
        self._bg = np.array([18, 20, 28], dtype=np.uint8)
        self._skin = np.array([232, 198, 174], dtype=np.uint8)
        self._base = self._load_image(avatar.image)

    def _load_image(self, path: str) -> np.ndarray | None:
        p = Path(path)
        if not p.exists():
            return None
        try:  # optional: use the supplied portrait if OpenCV is available
            import cv2

            img = cv2.imread(str(p), cv2.IMREAD_COLOR)
            if img is None:
                return None
            img = cv2.resize(img, (self.width, self.height))
            return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        except Exception:
            return None

    def render(self, bs: Blendshapes) -> np.ndarray:
        h, w = self.height, self.width
        frame = np.empty((h, w, 3), dtype=np.uint8)
        frame[:] = self._bg

        # Head translation from yaw/pitch + breathing bob.
        dx = bs.headYaw / 30.0 * w * 0.04
        dy = (bs.headPitch / 30.0) * h * 0.03 - bs.breath * h * 0.01

        fc = self.anchors.face_center
        cx, cy = fc[1] * w + dx, fc[0] * h + dy
        face_rx, face_ry = w * 0.30, h * 0.34

        if self._base is not None:
            frame = self._base.copy()
        else:
            mask = _disk(h, w, cy, cx, face_ry, face_rx)
            frame[mask] = self._skin

        # Eyes (blink closes vertical extent; gaze offsets pupil).
        for eye, blink, look_x, look_y in (
            (self.anchors.left_eye, bs.eyeBlinkLeft, bs.eyeLookOutLeft - bs.eyeLookInLeft,
             bs.eyeLookUpLeft - bs.eyeLookDownLeft),
            (self.anchors.right_eye, bs.eyeBlinkRight, bs.eyeLookInRight - bs.eyeLookOutRight,
             bs.eyeLookUpRight - bs.eyeLookDownRight),
        ):
            ex, ey = eye[1] * w + dx, eye[0] * h + dy
            open_amt = (1.0 - blink) * (1.0 + 0.4 * bs.eyeWideLeft)
            er_y = max(1.0, h * 0.022 * open_amt)
            er_x = w * 0.05
            frame[_disk(h, w, ey, ex, er_y, er_x)] = (250, 250, 252)
            if open_amt > 0.15:
                px = ex + look_x * er_x * 0.5
                py = ey - look_y * er_y * 0.6
                frame[_disk(h, w, py, px, er_y * 0.6, er_x * 0.4)] = (40, 40, 60)

        # Brows
        for brow_up, eye in ((bs.browOuterUpLeft + bs.browInnerUp, self.anchors.left_eye),
                             (bs.browOuterUpRight + bs.browInnerUp, self.anchors.right_eye)):
            bxc, byc = eye[1] * w + dx, eye[0] * h + dy - h * (0.04 + 0.02 * brow_up)
            frame[_disk(h, w, byc, bxc, h * 0.008, w * 0.06)] = (90, 70, 60)

        # Mouth: jawOpen -> vertical, funnel/pucker -> narrower, smile -> wider+up.
        mc = self.anchors.mouth_center
        mx, my = mc[1] * w + dx, mc[0] * h + dy
        smile = (bs.mouthSmileLeft + bs.mouthSmileRight) * 0.5
        width_scale = 1.0 + 0.4 * smile - 0.5 * bs.mouthPucker - 0.3 * bs.mouthFunnel
        mr_x = max(2.0, w * 0.10 * width_scale)
        mr_y = max(1.0, h * (0.012 + 0.09 * bs.jawOpen))
        my -= smile * h * 0.01
        frame[_disk(h, w, my, mx, mr_y, mr_x)] = (120, 50, 60)
        if bs.jawOpen > 0.1:  # inner mouth
            frame[_disk(h, w, my, mx, mr_y * 0.7, mr_x * 0.8)] = (60, 20, 30)

        return frame


def _build_renderer(config: AppConfig, avatar: AvatarDef) -> Renderer:
    kind = config.actor.renderer
    if kind == "mesh":
        from app.avatar.mesh_driver import MeshRenderer

        return MeshRenderer(config, avatar)
    if kind == "liveportrait":
        from app.avatar.liveportrait_adapter import LivePortraitRenderer

        return LivePortraitRenderer(config, avatar)
    return BlendshapeRenderer(config, avatar)


def create_renderer(config: AppConfig) -> Renderer:
    """Factory: build the renderer selected by ``actor.renderer`` config."""
    return _build_renderer(config, config.actor.active_avatar())


def encode_jpeg(frame: np.ndarray, quality: int = 80) -> bytes:
    """Encode an RGB frame to JPEG bytes (OpenCV if present, else BMP fallback)."""
    try:
        import cv2

        bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok:
            return buf.tobytes()
    except Exception:
        pass
    return _encode_bmp(frame)


def _encode_bmp(frame: np.ndarray) -> bytes:
    """Minimal uncompressed BMP encoder (no external deps)."""
    import struct

    h, w, _ = frame.shape
    bgr = frame[::-1, :, ::-1]  # BMP is bottom-up BGR
    row_padded = (w * 3 + 3) & ~3
    pad = row_padded - w * 3
    rows = b"".join(bgr[y].tobytes() + b"\x00" * pad for y in range(h))
    size = 54 + len(rows)
    header = b"BM" + struct.pack("<IHHI", size, 0, 0, 54)
    info = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(rows), 2835, 2835, 0, 0)
    return header + info + rows
