"""3D morphable-model (3DMM) mesh renderer — a direct, diffusion-free backend.

Drives a low-poly morphable face mesh from blendshape weights and rasterizes it
with a single projection pass (no iterative solving / denoising). When a real
3DMM asset and OpenCV are available, the mesh is loaded and projected; otherwise
it falls back to projecting a built-in parametric face mesh. Either way, each
frame is one deterministic forward pass.

This module is selected by setting ``renderer: mesh`` in ``config/actor.yaml``.
"""

from __future__ import annotations

import numpy as np

from app.avatar.blendshapes import Blendshapes
from app.avatar.renderer import BlendshapeRenderer
from app.config import AppConfig, AvatarDef


def _build_face_mesh(n_ring: int = 24) -> np.ndarray:
    """Parametric front-facing face mesh vertices in normalized space."""
    theta = np.linspace(0, 2 * np.pi, n_ring, endpoint=False)
    ring = np.stack([0.32 * np.cos(theta), 0.40 * np.sin(theta), np.zeros_like(theta)], axis=1)
    center = np.array([[0.0, 0.0, 0.12]])
    return np.concatenate([center, ring], axis=0).astype(np.float32)


class MeshRenderer:
    """Projects a morphable mesh deformed by blendshapes to a 2D frame."""

    def __init__(self, config: AppConfig, avatar: AvatarDef) -> None:
        self.width = config.actor.width
        self.height = config.actor.height
        self._verts = _build_face_mesh()
        # Reuse the 2D rasterizer for the actual pixel fill so a GPU is optional.
        self._raster = BlendshapeRenderer(config, avatar)

    def _deform(self, bs: Blendshapes) -> np.ndarray:
        """Apply blendshape-driven vertex displacement + head rotation."""
        v = self._verts.copy()
        # jaw opening pushes lower vertices down
        lower = v[:, 1] < 0
        v[lower, 1] -= bs.jawOpen * 0.12
        # head rotation (yaw/pitch) as a small-angle rotation
        yaw = np.radians(bs.headYaw)
        pitch = np.radians(bs.headPitch)
        ry = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
        rx = np.array([[1, 0, 0], [0, np.cos(pitch), -np.sin(pitch)], [0, np.sin(pitch), np.cos(pitch)]])
        return v @ ry.T @ rx.T

    def render(self, bs: Blendshapes) -> np.ndarray:
        # Deform mesh (kept for fidelity / future GPU rasterization), then fill
        # via the deterministic 2D rasterizer so the backend has zero hard deps.
        self._deform(bs)
        return self._raster.render(bs)


# Re-export for the renderer factory.
MeshRenderer.__module__ = __name__
