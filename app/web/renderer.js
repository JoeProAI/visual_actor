"use strict";

const VisualActorRenderer = (() => {
  const TAU = Math.PI * 2;
  const BLEND_KEYS = Object.freeze([
    "jawOpen",
    "mouthClose",
    "mouthFunnel",
    "mouthPucker",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthPressLeft",
    "mouthPressRight",
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "eyeWideLeft",
    "eyeWideRight",
    "eyeLookInLeft",
    "eyeLookOutLeft",
    "eyeLookUpLeft",
    "eyeLookDownLeft",
    "eyeLookInRight",
    "eyeLookOutRight",
    "eyeLookUpRight",
    "eyeLookDownRight",
    "browInnerUp",
    "browDownLeft",
    "browDownRight",
    "browOuterUpLeft",
    "browOuterUpRight",
    "headYaw",
    "headPitch",
    "headRoll",
    "breath",
  ]);

  function createIdlePose() {
    const pose = Object.create(null);
    for (const key of BLEND_KEYS) pose[key] = 0;
    pose.jawOpen = 0.018;
    pose.mouthClose = 0.16;
    pose.mouthSmileLeft = 0.07;
    pose.mouthSmileRight = 0.07;
    pose.mouthPressLeft = 0.04;
    pose.mouthPressRight = 0.04;
    pose.mouthStretchLeft = 0.03;
    pose.mouthStretchRight = 0.03;
    pose.eyeWideLeft = 0.10;
    pose.eyeWideRight = 0.10;
    pose.browInnerUp = 0.05;
    pose.browOuterUpLeft = 0.04;
    pose.browOuterUpRight = 0.04;
    pose.cheekSquintLeft = 0.02;
    pose.cheekSquintRight = 0.02;
    pose.cheekPuff = 0.01;
    pose.breath = 0.16;
    return pose;
  }

  function copyPose(dst, src) {
    const pose = src || EMPTY_POSE;
    for (const key of BLEND_KEYS) dst[key] = pose[key] || 0;
    return dst;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function rgba(hex, alpha) {
    return hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, "0");
  }

  function fillEllipse(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, TAU);
    ctx.fill();
  }

  function fillCircle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fill();
  }

  function createSurface(W, H) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(W, H);
    }
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    return canvas;
  }

  // ---------------------------------------------------------------------
  // Palette — cinematic portrait tones.
  // ---------------------------------------------------------------------
  const SKIN = {
    core: "#e9b795",
    light: "#f7d4b8",
    warm: "#dfa17d",
    shadow: "#b97d5e",
    deep: "#8f5843",
    blush: "#e58a7a",
    lipUpper: "#a35550",
    lipLower: "#c26b62",
    lipLine: "#7c3a38",
    mouthCavity: "#3c1215",
    tongue: "#b25a56",
    teeth: "#f6efe6",
  };
  const HAIR = {
    deep: "#141019",
    mid: "#2a2133",
    light: "#4a3a58",
    sheen: "#8b7aa8",
  };
  const IRIS = {
    outer: "#1e4a5f",
    mid: "#3a7d94",
    inner: "#6bb3c4",
    limbal: "#0b2530",
  };

  // ---------------------------------------------------------------------
  // Static backdrop (cached).
  // ---------------------------------------------------------------------
  const backdropCache = { width: 0, height: 0, surface: null };

  function getBackdropSurface(W, H) {
    if (!backdropCache.surface || backdropCache.width !== W || backdropCache.height !== H) {
      const surface = createSurface(W, H);
      drawBackdropStatic(surface.getContext("2d"), W, H);
      backdropCache.surface = surface;
      backdropCache.width = W;
      backdropCache.height = H;
    }
    return backdropCache.surface;
  }

  function drawBackdrop(ctx, W, H) {
    ctx.drawImage(getBackdropSurface(W, H), 0, 0);
  }

  function drawBackdropStatic(ctx, W, H) {
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#101627");
    base.addColorStop(0.55, "#0a0f1c");
    base.addColorStop(1, "#060912");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // Key light halo behind the head.
    const halo = ctx.createRadialGradient(W * 0.5, H * 0.40, 0, W * 0.5, H * 0.40, Math.max(W, H) * 0.52);
    halo.addColorStop(0, rgba("#3a5a8f", 0.55));
    halo.addColorStop(0.4, rgba("#26406b", 0.28));
    halo.addColorStop(1, rgba("#26406b", 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Cool accent from the left, warm from the right.
    const cool = ctx.createRadialGradient(W * 0.12, H * 0.22, 0, W * 0.12, H * 0.22, Math.max(W, H) * 0.5);
    cool.addColorStop(0, rgba("#4fc3e8", 0.14));
    cool.addColorStop(1, rgba("#4fc3e8", 0));
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, W, H);

    const warm = ctx.createRadialGradient(W * 0.88, H * 0.26, 0, W * 0.88, H * 0.26, Math.max(W, H) * 0.46);
    warm.addColorStop(0, rgba("#c78a4e", 0.10));
    warm.addColorStop(1, rgba("#c78a4e", 0));
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);

    // Faint bokeh dots for depth.
    const seedDots = [
      [0.14, 0.18, 0.020, 0.10], [0.22, 0.62, 0.015, 0.07], [0.08, 0.44, 0.012, 0.08],
      [0.87, 0.15, 0.022, 0.09], [0.92, 0.52, 0.013, 0.06], [0.80, 0.70, 0.017, 0.07],
      [0.30, 0.10, 0.011, 0.06], [0.70, 0.06, 0.014, 0.07],
    ];
    for (const [fx, fy, fr, fa] of seedDots) {
      const g = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, Math.min(W, H) * fr * 3);
      g.addColorStop(0, rgba("#9fd4ff", fa));
      g.addColorStop(1, rgba("#9fd4ff", 0));
      ctx.fillStyle = g;
      fillCircle(ctx, W * fx, H * fy, Math.min(W, H) * fr * 3);
    }

    // Vignette.
    const vignette = ctx.createRadialGradient(W * 0.50, H * 0.42, Math.min(W, H) * 0.14, W * 0.50, H * 0.48, Math.max(W, H) * 0.85);
    vignette.addColorStop(0, rgba("#000000", 0));
    vignette.addColorStop(1, rgba("#000000", 0.55));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------------
  // Body — shoulders, jacket, collar.
  // ---------------------------------------------------------------------
  function drawShoulders(ctx, W, H, breath) {
    const lift = breath * H * 0.014;
    const shoulderY = H * 0.40 - lift;

    // Jacket silhouette.
    const jacket = ctx.createLinearGradient(0, H * 0.16, 0, H * 0.55);
    jacket.addColorStop(0, "#232b3e");
    jacket.addColorStop(0.5, "#1a2233");
    jacket.addColorStop(1, "#121826");
    ctx.fillStyle = jacket;
    ctx.beginPath();
    ctx.moveTo(-W * 0.34, H * 0.55);
    ctx.lineTo(-W * 0.34, shoulderY + H * 0.02);
    ctx.quadraticCurveTo(-W * 0.30, H * 0.235, -W * 0.175, H * 0.205);
    ctx.quadraticCurveTo(-W * 0.06, H * 0.175, 0, H * 0.175);
    ctx.quadraticCurveTo(W * 0.06, H * 0.175, W * 0.175, H * 0.205);
    ctx.quadraticCurveTo(W * 0.30, H * 0.235, W * 0.34, shoulderY + H * 0.02);
    ctx.lineTo(W * 0.34, H * 0.55);
    ctx.closePath();
    ctx.fill();

    // Shoulder key-light sheen.
    const sheen = ctx.createLinearGradient(-W * 0.28, H * 0.20, -W * 0.05, H * 0.30);
    sheen.addColorStop(0, rgba("#7fa8d9", 0.16));
    sheen.addColorStop(1, rgba("#7fa8d9", 0));
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.moveTo(-W * 0.30, H * 0.26);
    ctx.quadraticCurveTo(-W * 0.24, H * 0.205, -W * 0.10, H * 0.19);
    ctx.lineTo(-W * 0.08, H * 0.23);
    ctx.quadraticCurveTo(-W * 0.20, H * 0.245, -W * 0.27, H * 0.30);
    ctx.closePath();
    ctx.fill();

    // Collar V and undershirt.
    ctx.fillStyle = "#0d121d";
    ctx.beginPath();
    ctx.moveTo(-W * 0.085, H * 0.185);
    ctx.quadraticCurveTo(0, H * 0.27 - lift, W * 0.085, H * 0.185);
    ctx.lineTo(W * 0.055, H * 0.30);
    ctx.quadraticCurveTo(0, H * 0.33, -W * 0.055, H * 0.30);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgba("#5a7ba8", 0.35);
    ctx.lineWidth = Math.max(1, W * 0.0035);
    ctx.beginPath();
    ctx.moveTo(-W * 0.085, H * 0.185);
    ctx.quadraticCurveTo(0, H * 0.27 - lift, W * 0.085, H * 0.185);
    ctx.stroke();

    // Soft ambient occlusion under the jaw.
    const ao = ctx.createRadialGradient(0, H * 0.19, 0, 0, H * 0.19, W * 0.16);
    ao.addColorStop(0, rgba("#000000", 0.38));
    ao.addColorStop(1, rgba("#000000", 0));
    ctx.fillStyle = ao;
    fillEllipse(ctx, 0, H * 0.20, W * 0.16, H * 0.055);
  }

  // ---------------------------------------------------------------------
  // Face structure.
  // ---------------------------------------------------------------------
  function faceSilhouette(ctx, rx, ry, jawOpen) {
    // Sculpted face: rounded cranium, tapered cheeks, defined chin.
    const chinDrop = ry * (0.02 + jawOpen * 0.085);
    ctx.beginPath();
    ctx.moveTo(0, -ry * 1.00);
    ctx.bezierCurveTo(rx * 0.62, -ry * 1.00, rx * 0.97, -ry * 0.62, rx * 0.98, -ry * 0.10);
    ctx.bezierCurveTo(rx * 0.985, ry * 0.20, rx * 0.82, ry * 0.48, rx * 0.48, ry * 0.72 + chinDrop * 0.5);
    ctx.bezierCurveTo(rx * 0.26, ry * 0.875 + chinDrop, rx * 0.11, ry * 0.92 + chinDrop, 0, ry * 0.92 + chinDrop);
    ctx.bezierCurveTo(-rx * 0.11, ry * 0.92 + chinDrop, -rx * 0.26, ry * 0.875 + chinDrop, -rx * 0.48, ry * 0.72 + chinDrop * 0.5);
    ctx.bezierCurveTo(-rx * 0.82, ry * 0.48, -rx * 0.985, ry * 0.20, -rx * 0.98, -ry * 0.10);
    ctx.bezierCurveTo(-rx * 0.97, -ry * 0.62, -rx * 0.62, -ry * 1.00, 0, -ry * 1.00);
    ctx.closePath();
  }

  function drawNeck(ctx, rx, ry, breath) {
    const w = rx * 0.42;
    const top = ry * 0.55;
    const bottom = ry * 1.42;
    const neck = ctx.createLinearGradient(-w, 0, w, 0);
    neck.addColorStop(0, SKIN.shadow);
    neck.addColorStop(0.35, SKIN.warm);
    neck.addColorStop(0.65, SKIN.core);
    neck.addColorStop(1, SKIN.shadow);
    ctx.fillStyle = neck;
    ctx.beginPath();
    ctx.moveTo(-w, top);
    ctx.quadraticCurveTo(-w * 1.08, ry * 1.05, -w * 1.30, bottom);
    ctx.lineTo(w * 1.30, bottom);
    ctx.quadraticCurveTo(w * 1.08, ry * 1.05, w, top);
    ctx.closePath();
    ctx.fill();

    // Jaw shadow cast on the neck.
    const shade = ctx.createLinearGradient(0, top, 0, ry * 1.05);
    shade.addColorStop(0, rgba("#5f3526", 0.55));
    shade.addColorStop(1, rgba("#5f3526", 0));
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(-w, top);
    ctx.quadraticCurveTo(0, top + ry * 0.16 + breath * ry * 0.02, w, top);
    ctx.lineTo(w * 1.05, ry * 1.08);
    ctx.lineTo(-w * 1.05, ry * 1.08);
    ctx.closePath();
    ctx.fill();

    // Sternocleidomastoid hint.
    ctx.strokeStyle = rgba(SKIN.deep, 0.18);
    ctx.lineWidth = rx * 0.03;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-w * 0.55, ry * 0.92);
    ctx.quadraticCurveTo(-w * 0.30, ry * 1.16, -w * 0.72, bottom * 0.97);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.55, ry * 0.92);
    ctx.quadraticCurveTo(w * 0.30, ry * 1.16, w * 0.72, bottom * 0.97);
    ctx.stroke();
  }

  function drawEars(ctx, rx, ry) {
    for (const side of [-1, 1]) {
      const x = side * rx * 0.97;
      const y = ry * 0.02;
      const earGrad = ctx.createLinearGradient(x - rx * 0.1 * side, y - ry * 0.1, x + rx * 0.12 * side, y + ry * 0.14);
      earGrad.addColorStop(0, SKIN.core);
      earGrad.addColorStop(1, SKIN.shadow);
      ctx.fillStyle = earGrad;
      fillEllipse(ctx, x, y, rx * 0.13, ry * 0.20, side * 0.12);
      // Inner helix shadow.
      ctx.strokeStyle = rgba(SKIN.deep, 0.5);
      ctx.lineWidth = rx * 0.020;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.ellipse(x + side * rx * 0.012, y, rx * 0.075, ry * 0.125, side * 0.16, Math.PI * 0.25, Math.PI * 1.35);
      ctx.stroke();
      ctx.fillStyle = rgba(SKIN.deep, 0.35);
      fillEllipse(ctx, x - side * rx * 0.015, y + ry * 0.06, rx * 0.035, ry * 0.045);
    }
  }

  function drawFaceBase(ctx, rx, ry, jawOpen, smile, cheekSquint, cheekPuff) {
    // Base skin with directional light (key from upper-left).
    const skin = ctx.createRadialGradient(-rx * 0.24, -ry * 0.34, rx * 0.12, 0, 0, rx * 1.55);
    skin.addColorStop(0, SKIN.light);
    skin.addColorStop(0.42, SKIN.core);
    skin.addColorStop(0.78, SKIN.warm);
    skin.addColorStop(1, SKIN.shadow);
    ctx.fillStyle = skin;
    faceSilhouette(ctx, rx, ry, jawOpen);
    ctx.fill();

    ctx.save();
    faceSilhouette(ctx, rx, ry, jawOpen);
    ctx.clip();

    // Right-side core shadow (form turning away from light).
    const formShadow = ctx.createLinearGradient(rx * 0.30, 0, rx * 1.02, 0);
    formShadow.addColorStop(0, rgba(SKIN.deep, 0));
    formShadow.addColorStop(1, rgba(SKIN.deep, 0.34));
    ctx.fillStyle = formShadow;
    ctx.fillRect(0, -ry, rx * 1.1, ry * 2.3);

    // Forehead highlight.
    const forehead = ctx.createRadialGradient(-rx * 0.10, -ry * 0.52, 0, -rx * 0.10, -ry * 0.52, rx * 0.72);
    forehead.addColorStop(0, rgba("#ffe9d4", 0.30));
    forehead.addColorStop(1, rgba("#ffe9d4", 0));
    ctx.fillStyle = forehead;
    fillEllipse(ctx, -rx * 0.08, -ry * 0.50, rx * 0.72, ry * 0.34);

    // Cheekbone planes.
    const cheekL = ctx.createRadialGradient(-rx * 0.48, ry * 0.10, 0, -rx * 0.48, ry * 0.10, rx * 0.42);
    cheekL.addColorStop(0, rgba("#ffdfc4", 0.24 + cheekSquint * 0.08));
    cheekL.addColorStop(1, rgba("#ffdfc4", 0));
    ctx.fillStyle = cheekL;
    fillEllipse(ctx, -rx * 0.48, ry * 0.10, rx * 0.40, ry * 0.26);

    const cheekR = ctx.createRadialGradient(rx * 0.44, ry * 0.12, 0, rx * 0.44, ry * 0.12, rx * 0.40);
    cheekR.addColorStop(0, rgba(SKIN.warm, 0.35));
    cheekR.addColorStop(1, rgba(SKIN.warm, 0));
    ctx.fillStyle = cheekR;
    fillEllipse(ctx, rx * 0.44, ry * 0.12, rx * 0.38, ry * 0.26);

    // Blush.
    const blushA = 0.10 + smile * 0.14 + cheekPuff * 0.10;
    for (const side of [-1, 1]) {
      const bl = ctx.createRadialGradient(side * rx * 0.52, ry * 0.22, 0, side * rx * 0.52, ry * 0.22, rx * 0.30);
      bl.addColorStop(0, rgba(SKIN.blush, blushA));
      bl.addColorStop(1, rgba(SKIN.blush, 0));
      ctx.fillStyle = bl;
      fillEllipse(ctx, side * rx * 0.52, ry * 0.22, rx * 0.28, ry * 0.17);
    }

    // Nasolabial softening when smiling.
    if (smile > 0.12) {
      ctx.strokeStyle = rgba(SKIN.deep, 0.10 + smile * 0.16);
      ctx.lineWidth = rx * 0.022;
      ctx.lineCap = "round";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * rx * 0.17, ry * 0.30);
        ctx.quadraticCurveTo(side * rx * 0.30, ry * 0.42, side * rx * 0.26, ry * 0.55);
        ctx.stroke();
      }
    }

    // Chin plane + jaw shadow.
    const chin = ctx.createRadialGradient(0, ry * 0.74, 0, 0, ry * 0.74, rx * 0.34);
    chin.addColorStop(0, rgba("#ffdfc4", 0.14));
    chin.addColorStop(1, rgba("#ffdfc4", 0));
    ctx.fillStyle = chin;
    fillEllipse(ctx, -rx * 0.03, ry * 0.72, rx * 0.24, ry * 0.13);

    const jawShade = ctx.createLinearGradient(0, ry * 0.62, 0, ry * 1.02);
    jawShade.addColorStop(0, rgba(SKIN.deep, 0));
    jawShade.addColorStop(1, rgba(SKIN.deep, 0.26));
    ctx.fillStyle = jawShade;
    ctx.fillRect(-rx, ry * 0.60, rx * 2, ry * 0.45);

    // Temple shadows under the hairline.
    for (const side of [-1, 1]) {
      const temple = ctx.createRadialGradient(side * rx * 0.70, -ry * 0.42, 0, side * rx * 0.70, -ry * 0.42, rx * 0.34);
      temple.addColorStop(0, rgba(SKIN.deep, 0.20));
      temple.addColorStop(1, rgba(SKIN.deep, 0));
      ctx.fillStyle = temple;
      fillEllipse(ctx, side * rx * 0.70, -ry * 0.42, rx * 0.30, ry * 0.24);
    }

    // Left rim light along the jaw (cool bounce).
    ctx.strokeStyle = rgba("#8fd8ff", 0.16);
    ctx.lineWidth = rx * 0.035;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-rx * 0.93, ry * 0.10);
    ctx.quadraticCurveTo(-rx * 0.72, ry * 0.62, -rx * 0.26, ry * 0.93);
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Hair — swept-back style with strand detail and sheen.
  // ---------------------------------------------------------------------
  function drawHairBack(ctx, rx, ry) {
    const grad = ctx.createLinearGradient(-rx, -ry * 1.2, rx * 0.6, ry * 0.4);
    grad.addColorStop(0, HAIR.light);
    grad.addColorStop(0.45, HAIR.mid);
    grad.addColorStop(1, HAIR.deep);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.10, rx * 1.10, ry * 1.10, -0.03, 0, TAU);
    ctx.fill();

    // Side volume.
    ctx.fillStyle = HAIR.deep;
    fillEllipse(ctx, -rx * 0.92, -ry * 0.18, rx * 0.28, ry * 0.52, 0.22);
    fillEllipse(ctx, rx * 0.92, -ry * 0.18, rx * 0.28, ry * 0.52, -0.22);
  }

  function drawHairFront(ctx, rx, ry) {
    // Swept-back top with a slight part on the left.
    const grad = ctx.createLinearGradient(-rx * 0.6, -ry * 1.1, rx * 0.5, -ry * 0.1);
    grad.addColorStop(0, HAIR.light);
    grad.addColorStop(0.5, HAIR.mid);
    grad.addColorStop(1, HAIR.deep);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-rx * 0.99, -ry * 0.28);
    ctx.bezierCurveTo(-rx * 1.04, -ry * 0.86, -rx * 0.55, -ry * 1.14, rx * 0.04, -ry * 1.10);
    ctx.bezierCurveTo(rx * 0.62, -ry * 1.13, rx * 1.03, -ry * 0.82, rx * 0.99, -ry * 0.26);
    // Right hairline sweeping down toward the temple.
    ctx.quadraticCurveTo(rx * 0.88, -ry * 0.44, rx * 0.68, -ry * 0.46);
    ctx.quadraticCurveTo(rx * 0.42, -ry * 0.52, rx * 0.20, -ry * 0.60);
    // Front fringe dips over the left brow.
    ctx.quadraticCurveTo(-rx * 0.05, -ry * 0.68, -rx * 0.28, -ry * 0.56);
    ctx.quadraticCurveTo(-rx * 0.52, -ry * 0.44, -rx * 0.72, -ry * 0.50);
    ctx.quadraticCurveTo(-rx * 0.90, -ry * 0.42, -rx * 0.99, -ry * 0.28);
    ctx.closePath();
    ctx.fill();

    // Strand shadows for texture.
    ctx.strokeStyle = rgba("#0b0810", 0.5);
    ctx.lineCap = "round";
    const strands = [
      [-0.62, -0.98, -0.40, -0.72, -0.44, -0.54],
      [-0.34, -1.04, -0.16, -0.78, -0.20, -0.62],
      [-0.06, -1.07, 0.08, -0.80, 0.02, -0.64],
      [0.24, -1.04, 0.36, -0.78, 0.30, -0.57],
      [0.52, -0.96, 0.62, -0.72, 0.58, -0.50],
      [0.76, -0.82, 0.84, -0.62, 0.80, -0.40],
    ];
    for (const [x1, y1, cxq, cyq, x2, y2] of strands) {
      ctx.lineWidth = rx * 0.018;
      ctx.beginPath();
      ctx.moveTo(rx * x1, ry * y1);
      ctx.quadraticCurveTo(rx * cxq, ry * cyq, rx * x2, ry * y2);
      ctx.stroke();
    }

    // Glossy sheen band across the top.
    const sheen = ctx.createLinearGradient(-rx * 0.5, -ry * 1.0, rx * 0.2, -ry * 0.55);
    sheen.addColorStop(0, rgba(HAIR.sheen, 0));
    sheen.addColorStop(0.5, rgba(HAIR.sheen, 0.28));
    sheen.addColorStop(1, rgba(HAIR.sheen, 0));
    ctx.strokeStyle = "transparent";
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.ellipse(-rx * 0.14, -ry * 0.80, rx * 0.62, ry * 0.20, -0.16, 0, TAU);
    ctx.fill();

    // Flyaway wisps.
    ctx.strokeStyle = rgba(HAIR.light, 0.5);
    ctx.lineWidth = rx * 0.010;
    ctx.beginPath();
    ctx.moveTo(-rx * 0.30, -ry * 1.06);
    ctx.quadraticCurveTo(-rx * 0.24, -ry * 1.18, -rx * 0.10, -ry * 1.16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rx * 0.30, -ry * 1.05);
    ctx.quadraticCurveTo(rx * 0.40, -ry * 1.16, rx * 0.52, -ry * 1.10);
    ctx.stroke();

    // Cool rim light on the crown.
    ctx.strokeStyle = rgba("#9ce8ff", 0.14);
    ctx.lineWidth = rx * 0.030;
    ctx.beginPath();
    ctx.arc(0, -ry * 0.10, rx * 1.02, Math.PI * 1.12, Math.PI * 1.55);
    ctx.stroke();
  }

  // ---------------------------------------------------------------------
  // Eyes.
  // ---------------------------------------------------------------------
  function drawEye(ctx, x, y, side, blink, wide, gazeXInput, gazeYInput, rx, ry) {
    const open = clamp((1 - blink * 0.98) * (0.90 + wide * 0.55), 0.02, 1.20);
    const eyeRx = rx * 0.185;
    const eyeRy = ry * 0.062 * open;
    const gazeX = clamp(gazeXInput * eyeRx * 0.30, -eyeRx * 0.28, eyeRx * 0.28);
    const gazeY = clamp(-gazeYInput * eyeRy * 0.34, -eyeRy * 0.30, eyeRy * 0.30);

    // Socket shading.
    const socket = ctx.createRadialGradient(x, y, 0, x, y, eyeRx * 1.7);
    socket.addColorStop(0, rgba(SKIN.deep, 0.16 + blink * 0.05));
    socket.addColorStop(1, rgba(SKIN.deep, 0));
    ctx.fillStyle = socket;
    fillEllipse(ctx, x, y + ry * 0.004, eyeRx * 1.55, eyeRy * 1.9 + ry * 0.030);

    // Almond-shaped sclera.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - eyeRx, y + eyeRy * 0.10);
    ctx.quadraticCurveTo(x - eyeRx * 0.35, y - eyeRy * 1.15, x + eyeRx * 0.30, y - eyeRy * 0.95);
    ctx.quadraticCurveTo(x + eyeRx * 0.85, y - eyeRy * 0.62, x + eyeRx, y + eyeRy * 0.02);
    ctx.quadraticCurveTo(x + eyeRx * 0.45, y + eyeRy * 1.05, x - eyeRx * 0.30, y + eyeRy * 0.95);
    ctx.quadraticCurveTo(x - eyeRx * 0.78, y + eyeRy * 0.62, x - eyeRx, y + eyeRy * 0.10);
    ctx.closePath();
    const sclera = ctx.createRadialGradient(x, y, 0, x, y, eyeRx * 1.1);
    sclera.addColorStop(0, "#fbf7f0");
    sclera.addColorStop(0.75, "#efe6da");
    sclera.addColorStop(1, "#d8c6b6");
    ctx.fillStyle = sclera;
    ctx.fill();
    ctx.clip();

    // Iris with limbal ring and radial striations.
    const irisR = Math.max(1, ry * 0.052);
    const ix = x + gazeX;
    const iy = y + gazeY;
    const iris = ctx.createRadialGradient(ix - irisR * 0.2, iy - irisR * 0.25, irisR * 0.1, ix, iy, irisR);
    iris.addColorStop(0, IRIS.inner);
    iris.addColorStop(0.55, IRIS.mid);
    iris.addColorStop(0.85, IRIS.outer);
    iris.addColorStop(1, IRIS.limbal);
    ctx.fillStyle = iris;
    fillCircle(ctx, ix, iy, irisR);

    ctx.strokeStyle = rgba("#0a2530", 0.55);
    ctx.lineWidth = Math.max(0.6, irisR * 0.06);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + side * 0.3;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(a) * irisR * 0.42, iy + Math.sin(a) * irisR * 0.42);
      ctx.lineTo(ix + Math.cos(a) * irisR * 0.88, iy + Math.sin(a) * irisR * 0.88);
      ctx.stroke();
    }

    // Pupil + catchlights.
    ctx.fillStyle = "#070a10";
    fillCircle(ctx, ix, iy, irisR * 0.40);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    fillCircle(ctx, ix - irisR * 0.32, iy - irisR * 0.34, irisR * 0.14);
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    fillCircle(ctx, ix + irisR * 0.26, iy + irisR * 0.22, irisR * 0.08);

    // Upper-lid cast shadow onto the eyeball.
    const lidShadow = ctx.createLinearGradient(0, y - eyeRy * 1.2, 0, y - eyeRy * 0.1);
    lidShadow.addColorStop(0, rgba("#4a2e22", 0.5));
    lidShadow.addColorStop(1, rgba("#4a2e22", 0));
    ctx.fillStyle = lidShadow;
    ctx.fillRect(x - eyeRx, y - eyeRy * 1.3, eyeRx * 2, eyeRy * 0.9);
    ctx.restore();

    // Upper lash line — thick, tapered.
    ctx.strokeStyle = "#1a0f12";
    ctx.lineCap = "round";
    ctx.lineWidth = rx * 0.020;
    ctx.beginPath();
    ctx.moveTo(x - eyeRx * 1.02, y + eyeRy * 0.05);
    ctx.quadraticCurveTo(x - eyeRx * 0.30, y - eyeRy * 1.30, x + eyeRx * 0.40, y - eyeRy * 1.05);
    ctx.quadraticCurveTo(x + eyeRx * 0.85, y - eyeRy * 0.70, x + eyeRx * 1.05, y - eyeRy * 0.02);
    ctx.stroke();

    // Outer lash flick.
    ctx.lineWidth = rx * 0.014;
    ctx.beginPath();
    ctx.moveTo(x + side * eyeRx * 0.95, y - eyeRy * 0.35);
    ctx.quadraticCurveTo(x + side * eyeRx * 1.20, y - eyeRy * 0.85, x + side * eyeRx * 1.35, y - eyeRy * 1.05);
    ctx.stroke();

    // Lower lash line — faint.
    ctx.strokeStyle = rgba("#3a2620", 0.35);
    ctx.lineWidth = rx * 0.009;
    ctx.beginPath();
    ctx.moveTo(x - eyeRx * 0.80, y + eyeRy * 0.75);
    ctx.quadraticCurveTo(x, y + eyeRy * 1.15, x + eyeRx * 0.85, y + eyeRy * 0.55);
    ctx.stroke();

    // Crease above the lid.
    ctx.strokeStyle = rgba(SKIN.deep, 0.18);
    ctx.lineWidth = rx * 0.011;
    ctx.beginPath();
    ctx.moveTo(x - eyeRx * 0.80, y - eyeRy * 1.55 - ry * 0.012);
    ctx.quadraticCurveTo(x, y - eyeRy * 2.1 - ry * 0.014, x + eyeRx * 0.82, y - eyeRy * 1.45 - ry * 0.010);
    ctx.stroke();

    // Closed eyelid overlay on blink.
    if (blink > 0.14) {
      const lidH = Math.max(eyeRy, ry * 0.020) * (1.5 + blink * 1.1);
      const lid = ctx.createLinearGradient(0, y - lidH, 0, y + lidH * 0.5);
      lid.addColorStop(0, SKIN.core);
      lid.addColorStop(1, SKIN.warm);
      ctx.fillStyle = lid;
      ctx.beginPath();
      ctx.roundRect(x - eyeRx * 1.08, y - lidH * 0.55, eyeRx * 2.16, lidH, eyeRx * 0.4);
      ctx.fill();
      ctx.strokeStyle = rgba("#1a0f12", 0.75);
      ctx.lineWidth = rx * 0.014;
      ctx.beginPath();
      ctx.moveTo(x - eyeRx * 0.95, y + eyeRy * 0.1);
      ctx.quadraticCurveTo(x, y + eyeRy * 0.55, x + eyeRx * 0.95, y + eyeRy * 0.05);
      ctx.stroke();
    }

    // Undereye light plane.
    ctx.fillStyle = rgba("#ffe4cd", 0.10);
    fillEllipse(ctx, x, y + eyeRy * 2.1 + ry * 0.012, eyeRx * 0.85, ry * 0.020);
  }

  // ---------------------------------------------------------------------
  // Brows — tapered natural shape.
  // ---------------------------------------------------------------------
  function drawBrow(ctx, x, y, side, innerUp, outerUp, down, rx, ry) {
    const lift = (outerUp * 0.7 + innerUp * 0.5 - down) * ry * 0.10;
    const innerLift = (innerUp - down * 0.6) * ry * 0.09;
    const inX = x - side * rx * 0.17;
    const outX = x + side * rx * 0.20;

    ctx.save();
    ctx.fillStyle = "#241a20";
    ctx.beginPath();
    ctx.moveTo(inX, y + ry * 0.012 + innerLift);
    ctx.quadraticCurveTo(x - side * rx * 0.02, y - ry * 0.030 + lift * 0.8 + innerLift * 0.4, x + side * rx * 0.09, y - ry * 0.026 + lift);
    ctx.quadraticCurveTo(x + side * rx * 0.16, y - ry * 0.020 + lift, outX, y + ry * 0.004 + lift * 1.1);
    ctx.quadraticCurveTo(x + side * rx * 0.14, y + ry * 0.016 + lift, x + side * rx * 0.05, y + ry * 0.018 + lift * 0.8);
    ctx.quadraticCurveTo(x - side * rx * 0.06, y + ry * 0.024 + innerLift * 0.7, inX, y + ry * 0.012 + innerLift);
    ctx.closePath();
    ctx.fill();

    // Brow hair strokes.
    ctx.strokeStyle = rgba("#3a2a33", 0.8);
    ctx.lineWidth = rx * 0.007;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const bx = inX + (outX - inX) * t;
      const by = y + innerLift * (1 - t) + lift * t - ry * 0.012 * Math.sin(t * Math.PI);
      ctx.beginPath();
      ctx.moveTo(bx, by + ry * 0.014);
      ctx.lineTo(bx + side * rx * 0.020, by - ry * 0.008);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // Nose — bridge, tip, nostrils, highlight.
  // ---------------------------------------------------------------------
  function drawNose(ctx, rx, ry) {
    const tipY = ry * 0.27;

    // Soft bridge side shadow (light comes from the left).
    const bridge = ctx.createRadialGradient(rx * 0.06, ry * 0.10, 0, rx * 0.06, ry * 0.10, rx * 0.14);
    bridge.addColorStop(0, rgba(SKIN.shadow, 0.20));
    bridge.addColorStop(1, rgba(SKIN.shadow, 0));
    ctx.fillStyle = bridge;
    fillEllipse(ctx, rx * 0.055, ry * 0.10, rx * 0.05, ry * 0.11, 0.06);

    // Bridge highlight.
    const shine = ctx.createRadialGradient(-rx * 0.02, ry * 0.08, 0, -rx * 0.02, ry * 0.08, rx * 0.12);
    shine.addColorStop(0, rgba("#ffe9d4", 0.28));
    shine.addColorStop(1, rgba("#ffe9d4", 0));
    ctx.fillStyle = shine;
    fillEllipse(ctx, -rx * 0.02, ry * 0.08, rx * 0.045, ry * 0.12);

    // Tip ball with soft light.
    const tip = ctx.createRadialGradient(-rx * 0.02, tipY - ry * 0.024, 0, 0, tipY - ry * 0.01, rx * 0.11);
    tip.addColorStop(0, rgba("#ffdfc4", 0.40));
    tip.addColorStop(0.7, rgba(SKIN.warm, 0.24));
    tip.addColorStop(1, rgba(SKIN.warm, 0));
    ctx.fillStyle = tip;
    fillCircle(ctx, 0, tipY - ry * 0.012, rx * 0.105);

    // Alae (nostril wings).
    for (const side of [-1, 1]) {
      ctx.fillStyle = rgba(SKIN.shadow, 0.32);
      fillEllipse(ctx, side * rx * 0.105, tipY, rx * 0.052, ry * 0.028, side * 0.5);
    }

    // Nostrils.
    ctx.fillStyle = rgba("#57281c", 0.62);
    fillEllipse(ctx, -rx * 0.062, tipY + ry * 0.018, rx * 0.028, ry * 0.012, -0.45);
    fillEllipse(ctx, rx * 0.062, tipY + ry * 0.018, rx * 0.028, ry * 0.012, 0.45);

    // Shadow under the nose.
    const under = ctx.createRadialGradient(0, tipY + ry * 0.038, 0, 0, tipY + ry * 0.038, rx * 0.11);
    under.addColorStop(0, rgba(SKIN.deep, 0.22));
    under.addColorStop(1, rgba(SKIN.deep, 0));
    ctx.fillStyle = under;
    fillEllipse(ctx, 0, tipY + ry * 0.040, rx * 0.10, ry * 0.024);
  }

  // ---------------------------------------------------------------------
  // Mouth — sculpted lips with cupid's bow, teeth, tongue.
  // ---------------------------------------------------------------------
  function drawMouth(ctx, rx, ry, jawOpen, smile, frown, pucker, funnel, stretch, press) {
    const mouthY = ry * 0.52 + (frown - smile) * ry * 0.045;
    const width = rx * (0.52 + stretch * 0.14 - pucker * 0.17 - funnel * 0.13 - press * 0.06);
    const open = ry * clamp(0.035 + jawOpen * 0.44 + funnel * 0.12 - press * 0.05, 0.028, 0.32);
    const corner = (smile - frown) * ry * 0.055;
    const half = width * 0.5;

    // Philtrum groove — short, soft dimple above the upper lip.
    ctx.strokeStyle = rgba(SKIN.shadow, 0.16);
    ctx.lineWidth = rx * 0.012;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-rx * 0.018, mouthY - open - ry * 0.075);
    ctx.lineTo(-rx * 0.020, mouthY - open - ry * 0.038);
    ctx.moveTo(rx * 0.018, mouthY - open - ry * 0.075);
    ctx.lineTo(rx * 0.020, mouthY - open - ry * 0.038);
    ctx.stroke();

    // Mouth cavity.
    if (jawOpen > 0.03 || funnel > 0.1) {
      ctx.fillStyle = SKIN.mouthCavity;
      ctx.beginPath();
      ctx.ellipse(0, mouthY, half * 0.92, open * 0.98, 0, 0, TAU);
      ctx.fill();

      // Upper teeth.
      if (open > ry * 0.045) {
        const teethW = half * 1.28;
        const teethH = Math.min(open * 0.52, ry * 0.052);
        const teeth = ctx.createLinearGradient(0, mouthY - open * 0.85, 0, mouthY - open * 0.85 + teethH);
        teeth.addColorStop(0, SKIN.teeth);
        teeth.addColorStop(1, "#d9cbb8");
        ctx.fillStyle = teeth;
        ctx.beginPath();
        ctx.roundRect(-teethW * 0.5, mouthY - open * 0.88, teethW, teethH, teethH * 0.35);
        ctx.fill();
        // Tooth separations.
        ctx.strokeStyle = rgba("#b7a48e", 0.5);
        ctx.lineWidth = Math.max(0.6, rx * 0.006);
        for (let i = -2; i <= 2; i++) {
          const tx = i * teethW * 0.16;
          ctx.beginPath();
          ctx.moveTo(tx, mouthY - open * 0.87);
          ctx.lineTo(tx, mouthY - open * 0.88 + teethH * 0.9);
          ctx.stroke();
        }
      }

      // Tongue.
      if (open > ry * 0.075) {
        const tongue = ctx.createRadialGradient(0, mouthY + open * 0.45, 0, 0, mouthY + open * 0.45, half * 0.6);
        tongue.addColorStop(0, SKIN.tongue);
        tongue.addColorStop(1, "#8a3f3d");
        ctx.fillStyle = tongue;
        fillEllipse(ctx, 0, mouthY + open * 0.48, half * 0.56, open * 0.42);
      }
    }

    // Upper lip with cupid's bow.
    const upTop = mouthY - open - ry * 0.028 - corner * 0.2;
    const upLip = ctx.createLinearGradient(0, upTop, 0, mouthY - open * 0.2);
    upLip.addColorStop(0, SKIN.lipUpper);
    upLip.addColorStop(1, SKIN.lipLine);
    ctx.fillStyle = upLip;
    ctx.beginPath();
    ctx.moveTo(-half - rx * 0.01, mouthY - corner);
    ctx.quadraticCurveTo(-half * 0.55, upTop + ry * 0.002, -half * 0.20, upTop);
    ctx.quadraticCurveTo(-half * 0.07, upTop - ry * 0.006, 0, upTop + ry * 0.008);
    ctx.quadraticCurveTo(half * 0.07, upTop - ry * 0.006, half * 0.20, upTop);
    ctx.quadraticCurveTo(half * 0.55, upTop + ry * 0.002, half + rx * 0.01, mouthY - corner);
    ctx.quadraticCurveTo(half * 0.42, mouthY - open * 0.90, 0, mouthY - open * 0.92);
    ctx.quadraticCurveTo(-half * 0.42, mouthY - open * 0.90, -half - rx * 0.01, mouthY - corner);
    ctx.closePath();
    ctx.fill();

    // Lower lip — full with gloss.
    const lowBottom = mouthY + open + ry * 0.045 + corner * 0.10;
    const lowLip = ctx.createLinearGradient(0, mouthY + open * 0.2, 0, lowBottom);
    lowLip.addColorStop(0, SKIN.lipLine);
    lowLip.addColorStop(0.45, SKIN.lipLower);
    lowLip.addColorStop(1, "#a25049");
    ctx.fillStyle = lowLip;
    ctx.beginPath();
    ctx.moveTo(-half - rx * 0.01, mouthY - corner);
    ctx.quadraticCurveTo(-half * 0.42, mouthY + open * 0.90, 0, mouthY + open * 0.92);
    ctx.quadraticCurveTo(half * 0.42, mouthY + open * 0.90, half + rx * 0.01, mouthY - corner);
    ctx.quadraticCurveTo(half * 0.55, lowBottom, 0, lowBottom + ry * 0.004);
    ctx.quadraticCurveTo(-half * 0.55, lowBottom, -half - rx * 0.01, mouthY - corner);
    ctx.closePath();
    ctx.fill();

    // Lip seam.
    ctx.strokeStyle = rgba("#5c2624", 0.7);
    ctx.lineWidth = rx * 0.013;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-half, mouthY - corner);
    ctx.quadraticCurveTo(0, mouthY + corner * 0.3 + open * 0.06, half, mouthY - corner);
    ctx.stroke();

    // Lower-lip gloss.
    ctx.fillStyle = rgba("#ffd9d4", 0.26);
    fillEllipse(ctx, -half * 0.12, mouthY + open * 0.55 + ry * 0.014, half * 0.34, Math.max(1, open * 0.16 + ry * 0.008));

    // Corner dimples.
    ctx.fillStyle = rgba(SKIN.deep, 0.28 + smile * 0.18);
    fillCircle(ctx, -half - rx * 0.018, mouthY - corner, rx * 0.014);
    fillCircle(ctx, half + rx * 0.018, mouthY - corner, rx * 0.014);

    // Shadow under the lower lip.
    const underLip = ctx.createLinearGradient(0, lowBottom, 0, lowBottom + ry * 0.05);
    underLip.addColorStop(0, rgba(SKIN.deep, 0.24));
    underLip.addColorStop(1, rgba(SKIN.deep, 0));
    ctx.fillStyle = underLip;
    fillEllipse(ctx, 0, lowBottom + ry * 0.024, half * 0.7, ry * 0.022);
  }

  // ---------------------------------------------------------------------
  // Head composition.
  // ---------------------------------------------------------------------
  function drawHead(ctx, rx, ry, pose) {
    const smile = ((pose.mouthSmileLeft || 0) + (pose.mouthSmileRight || 0)) * 0.5;
    const frown = ((pose.mouthFrownLeft || 0) + (pose.mouthFrownRight || 0)) * 0.5;
    const press = ((pose.mouthPressLeft || 0) + (pose.mouthPressRight || 0)) * 0.5;
    const stretch = ((pose.mouthStretchLeft || 0) + (pose.mouthStretchRight || 0)) * 0.5;
    const cheekSquint = ((pose.cheekSquintLeft || 0) + (pose.cheekSquintRight || 0)) * 0.5;
    const jawOpen = pose.jawOpen || 0;

    drawHairBack(ctx, rx, ry);
    drawNeck(ctx, rx, ry, pose.breath || 0);
    drawEars(ctx, rx, ry);
    drawFaceBase(ctx, rx, ry, jawOpen, smile, cheekSquint, pose.cheekPuff || 0);

    const eyeY = -ry * 0.10;
    drawEye(
      ctx, -rx * 0.38, eyeY, -1,
      pose.eyeBlinkLeft || 0, pose.eyeWideLeft || 0,
      (pose.eyeLookOutLeft || 0) - (pose.eyeLookInLeft || 0),
      (pose.eyeLookUpLeft || 0) - (pose.eyeLookDownLeft || 0),
      rx, ry,
    );
    drawEye(
      ctx, rx * 0.38, eyeY, 1,
      pose.eyeBlinkRight || 0, pose.eyeWideRight || 0,
      (pose.eyeLookInRight || 0) - (pose.eyeLookOutRight || 0),
      (pose.eyeLookUpRight || 0) - (pose.eyeLookDownRight || 0),
      rx, ry,
    );

    drawBrow(ctx, -rx * 0.38, -ry * 0.27, -1, pose.browInnerUp || 0, pose.browOuterUpLeft || 0, pose.browDownLeft || 0, rx, ry);
    drawBrow(ctx, rx * 0.38, -ry * 0.27, 1, pose.browInnerUp || 0, pose.browOuterUpRight || 0, pose.browDownRight || 0, rx, ry);

    drawNose(ctx, rx, ry);
    drawMouth(ctx, rx, ry, jawOpen, smile, frown, pose.mouthPucker || 0, pose.mouthFunnel || 0, stretch, press);
    drawHairFront(ctx, rx, ry);
  }

  function drawAvatar(ctx, bs, W, H, options = {}) {
    const pose = bs || EMPTY_POSE;
    const background = options.background !== false;
    const headYaw = pose.headYaw || 0;
    const headPitch = pose.headPitch || 0;
    const headRoll = pose.headRoll || 0;
    const breath = pose.breath || 0;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (background) drawBackdrop(ctx, W, H);

    const headRx = W * 0.225;
    const headRy = H * 0.26;
    const cx = W * 0.5 + (headYaw / 30) * W * 0.055;
    const cy = H * 0.44 + (headPitch / 30) * H * 0.045 + breath * H * 0.010;
    const roll = clamp(headRoll, -28, 28) * (Math.PI / 180) * 0.36;

    ctx.translate(cx, cy);

    // Body stays grounded; only the head rolls.
    ctx.save();
    ctx.translate(0, H * 0.06);
    drawShoulders(ctx, W, H, breath);
    ctx.restore();

    ctx.rotate(roll);
    drawHead(ctx, headRx, headRy, pose);

    ctx.restore();
  }

  const EMPTY_POSE = createIdlePose();

  return {
    BLEND_KEYS,
    EMPTY_POSE,
    createIdlePose,
    copyPose,
    drawAvatar,
  };
})();

window.VisualActorAvatar = VisualActorRenderer;
