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

  function fillEllipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU);
    ctx.fill();
  }

  function fillCircle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fill();
  }

  function strokeCurve(ctx, points, strokeStyle, lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 4) {
      ctx.quadraticCurveTo(points[i], points[i + 1], points[i + 2], points[i + 3]);
    }
    ctx.stroke();
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

  const backdropCache = {
    width: 0,
    height: 0,
    surface: null,
  };

  function getBackdropSurface(W, H) {
    if (!backdropCache.surface || backdropCache.width !== W || backdropCache.height !== H) {
      const surface = createSurface(W, H);
      const surfaceCtx = surface.getContext("2d");
      drawBackdropStatic(surfaceCtx, W, H);
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
    base.addColorStop(0, "#0d1322");
    base.addColorStop(0.56, "#090e18");
    base.addColorStop(1, "#070a12");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    const glowA = ctx.createRadialGradient(W * 0.30, H * 0.20, 0, W * 0.30, H * 0.20, Math.max(W, H) * 0.55);
    glowA.addColorStop(0, rgba("#62d8ff", 0.20));
    glowA.addColorStop(0.45, rgba("#62d8ff", 0.08));
    glowA.addColorStop(1, rgba("#62d8ff", 0));
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, W, H);

    const glowB = ctx.createRadialGradient(W * 0.78, H * 0.18, 0, W * 0.78, H * 0.18, Math.max(W, H) * 0.42);
    glowB.addColorStop(0, rgba("#9f7dff", 0.18));
    glowB.addColorStop(0.55, rgba("#9f7dff", 0.05));
    glowB.addColorStop(1, rgba("#9f7dff", 0));
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, W, H);

    const vignette = ctx.createRadialGradient(W * 0.50, H * 0.42, Math.min(W, H) * 0.12, W * 0.50, H * 0.48, Math.max(W, H) * 0.90);
    vignette.addColorStop(0, rgba("#000000", 0));
    vignette.addColorStop(1, rgba("#000000", 0.48));
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function drawShoulders(ctx, W, H, breath, smile, cheek) {
    const shoulderY = H * 0.39 + breath * H * 0.018;
    ctx.fillStyle = "#171d2a";
    ctx.beginPath();
    ctx.moveTo(-W * 0.32, shoulderY);
    ctx.quadraticCurveTo(-W * 0.26, H * 0.23, -W * 0.16, H * 0.21);
    ctx.quadraticCurveTo(0, H * 0.17, W * 0.16, H * 0.21);
    ctx.quadraticCurveTo(W * 0.26, H * 0.23, W * 0.32, shoulderY);
    ctx.lineTo(W * 0.32, H * 0.53);
    ctx.lineTo(-W * 0.32, H * 0.53);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba("#6fb8ff", 0.05);
    ctx.fillRect(-W * 0.24, H * 0.19, W * 0.48, H * 0.05);

    ctx.fillStyle = rgba("#ffffff", 0.04 + cheek * 0.02 + smile * 0.01);
    fillEllipse(ctx, 0, H * 0.25, W * 0.13, H * 0.07);

    ctx.fillStyle = rgba("#000000", 0.18);
    fillEllipse(ctx, -W * 0.20, shoulderY + H * 0.01, W * 0.13, H * 0.03);
    fillEllipse(ctx, W * 0.20, shoulderY + H * 0.01, W * 0.13, H * 0.03);
  }

  function drawHead(ctx, W, H, state, breath) {
    const { headRx, headRy, jawOpen, smile, frown, press, pucker, funnel, stretch } = state;
    const cx = 0;
    const cy = 0;
    const skinShadow = "#c89176";
    const skinLight = "#f2cdb7";
    const skinCore = "#e8baa1";
    const hairDark = "#14121d";
    const hairMid = "#252032";
    const hairLight = "#3d3552";

    // Hair mass behind the face.
    const hair = ctx.createLinearGradient(-headRx, -headRy * 1.1, headRx * 0.35, headRy * 0.8);
    hair.addColorStop(0, hairLight);
    hair.addColorStop(0.38, hairMid);
    hair.addColorStop(1, hairDark);
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.ellipse(0, -headRy * 0.08, headRx * 1.04, headRy * 1.07, -0.04, 0, TAU);
    ctx.fill();

    // Ears.
    ctx.fillStyle = skinShadow;
    fillEllipse(ctx, -headRx * 0.92, -headRy * 0.02, headRx * 0.12, headRy * 0.21);
    fillEllipse(ctx, headRx * 0.92, -headRy * 0.02, headRx * 0.12, headRy * 0.21);

    // Face silhouette and skin shading.
    ctx.fillStyle = skinCore;
    ctx.beginPath();
    ctx.ellipse(0, 0, headRx, headRy, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = rgba("#ffffff", 0.10);
    fillEllipse(ctx, -headRx * 0.22, -headRy * 0.30, headRx * 0.74, headRy * 0.84);
    ctx.fillStyle = rgba("#9b6555", 0.10 + smile * 0.04);
    fillEllipse(ctx, headRx * 0.22, headRy * 0.22, headRx * 0.72, headRy * 0.84);

    // Neck.
    const neck = ctx.createLinearGradient(-headRx * 0.15, headRy * 0.55, headRx * 0.22, headRy * 0.95);
    neck.addColorStop(0, skinCore);
    neck.addColorStop(1, skinShadow);
    ctx.fillStyle = neck;
    ctx.beginPath();
    ctx.roundRect(-headRx * 0.17, headRy * 0.63, headRx * 0.34, headRy * 0.36, headRx * 0.05);
    ctx.fill();

    // Jaw and chin shading.
    ctx.fillStyle = rgba("#9b6555", 0.18);
    fillEllipse(ctx, 0, headRy * 0.68, headRx * 0.54, headRy * 0.22);

    // Front hair and fringe.
    ctx.fillStyle = hairDark;
    ctx.beginPath();
    ctx.moveTo(-headRx * 0.88, -headRy * 0.58);
    ctx.quadraticCurveTo(-headRx * 0.62, -headRy * 1.05, -headRx * 0.10, -headRy * 1.02);
    ctx.quadraticCurveTo(headRx * 0.38, -headRy * 1.06, headRx * 0.84, -headRy * 0.46);
    ctx.quadraticCurveTo(headRx * 0.64, -headRy * 0.20, headRx * 0.40, -headRy * 0.36);
    ctx.quadraticCurveTo(headRx * 0.18, -headRy * 0.48, headRx * 0.02, -headRy * 0.52);
    ctx.quadraticCurveTo(-headRx * 0.20, -headRy * 0.45, -headRx * 0.52, -headRy * 0.32);
    ctx.quadraticCurveTo(-headRx * 0.70, -headRy * 0.24, -headRx * 0.88, -headRy * 0.58);
    ctx.closePath();
    ctx.fill();

    // Subtle rim light on the hair.
    ctx.strokeStyle = rgba("#9ce8ff", 0.08);
    ctx.lineWidth = headRx * 0.03;
    ctx.beginPath();
    ctx.arc(0, -headRy * 0.05, headRx * 0.98, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();

    // Eyes.
    drawEye(
      ctx,
      -headRx * 0.40,
      -headRy * 0.12,
      state.eyeBlinkLeft || 0,
      state.eyeWideLeft || 0,
      ((state.eyeLookOutLeft || 0) - (state.eyeLookInLeft || 0)) + ((state.eyeLookOutRight || 0) - (state.eyeLookInRight || 0)) * 0.14,
      ((state.eyeLookUpLeft || 0) - (state.eyeLookDownLeft || 0)) + ((state.eyeLookUpRight || 0) - (state.eyeLookDownRight || 0)) * 0.14,
      headRx,
      headRy,
      skinCore,
      hairDark,
    );
    drawEye(
      ctx,
      headRx * 0.40,
      -headRy * 0.12,
      state.eyeBlinkRight || 0,
      state.eyeWideRight || 0,
      ((state.eyeLookInRight || 0) - (state.eyeLookOutRight || 0)) + ((state.eyeLookInLeft || 0) - (state.eyeLookOutLeft || 0)) * 0.14,
      ((state.eyeLookUpRight || 0) - (state.eyeLookDownRight || 0)) + ((state.eyeLookUpLeft || 0) - (state.eyeLookDownLeft || 0)) * 0.14,
      headRx,
      headRy,
      skinCore,
      hairDark,
    );

    // Eyebrows.
    drawBrow(
      ctx,
      -headRx * 0.42,
      -headRy * 0.33,
      -0.08,
      state.browInnerUp || 0,
      state.browOuterUpLeft || 0,
      state.browDownLeft || 0,
      hairDark,
      headRx,
      headRy,
    );
    drawBrow(
      ctx,
      headRx * 0.42,
      -headRy * 0.33,
      0.08,
      state.browInnerUp || 0,
      state.browOuterUpRight || 0,
      state.browDownRight || 0,
      hairDark,
      headRx,
      headRy,
    );

    // Nose.
    drawNose(ctx, 0, 0, headRx, headRy, skinShadow);

    // Cheeks and smile warmth.
    drawCheeks(
      ctx,
      0,
      0,
      headRx,
      headRy,
      smile,
      ((state.cheekSquintLeft || 0) + (state.cheekSquintRight || 0)) * 0.5,
      state.cheekPuff || 0,
      breath,
    );

    // Mouth and lips.
    drawMouth(
      ctx,
      0,
      0,
      headRx,
      headRy,
      jawOpen,
      smile,
      frown,
      pucker,
      funnel,
      stretch,
      press,
    );
  }

  function drawEye(ctx, x, y, blink, wide, gazeXInput, gazeYInput, headRx, headRy, skinTone, shadowTone) {
    const open = clamp((1 - blink * 0.98) * (0.98 + wide * 0.52), 0.04, 1.28);
    const rx = headRx * 0.20;
    const ry = headRy * 0.09 * open;
    const gazeX = clamp(gazeXInput * rx * 0.24, -rx * 0.22, rx * 0.22);
    const gazeY = clamp(-gazeYInput * ry * 0.26, -ry * 0.22, ry * 0.22);

    // Socket shadow.
    ctx.fillStyle = rgba("#000000", 0.13 + blink * 0.06);
    fillEllipse(ctx, x, y + headRy * 0.006, rx * 1.10, ry * 1.48 + headRy * 0.02);

    // Sclera.
    ctx.fillStyle = "#f5f1ec";
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();

    // Upper and lower lids.
    ctx.strokeStyle = rgba(shadowTone, 0.72);
    ctx.lineWidth = headRx * 0.02;
    ctx.beginPath();
    ctx.ellipse(x, y + headRy * 0.004, rx * 1.02, ry * 0.95, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();
    ctx.strokeStyle = rgba(skinTone, 0.42);
    ctx.beginPath();
    ctx.ellipse(x, y + headRy * 0.014, rx * 1.00, ry * 0.82, 0, 0.03, Math.PI - 0.03);
    ctx.stroke();

    // Iris.
    const irisR = ry * 0.95;
    const irisX = x + gazeX;
    const irisY = y + gazeY;
    ctx.fillStyle = "#315d7d";
    fillCircle(ctx, irisX, irisY, irisR);
    ctx.fillStyle = "#0c111a";
    fillCircle(ctx, irisX, irisY, irisR * 0.40);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    fillCircle(ctx, irisX - irisR * 0.30, irisY - irisR * 0.28, irisR * 0.13);

    // Closed eyelid on blink.
    if (blink > 0.14) {
      const lidH = ry * (1.35 + blink * 0.85);
      ctx.fillStyle = rgba(skinTone, 0.96);
      ctx.beginPath();
      ctx.roundRect(x - rx * 1.10, y - lidH * 0.52, rx * 2.20, lidH, rx * 0.38);
      ctx.fill();
      ctx.strokeStyle = rgba(shadowTone, 0.32);
      ctx.lineWidth = headRx * 0.014;
      ctx.beginPath();
      ctx.ellipse(x, y, rx * 0.98, ry * 0.20, 0, 0, TAU);
      ctx.stroke();
    }
  }

  function drawBrow(ctx, x, y, tilt, innerUp, outerUp, down, hairTone, headRx, headRy) {
    const lift = (outerUp + innerUp - down) * headRy * 0.11;
    ctx.strokeStyle = hairTone;
    ctx.lineWidth = headRx * 0.085;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - headRx * 0.16, y + lift);
    ctx.quadraticCurveTo(x, y - headRy * 0.03 + lift + tilt * headRy * 0.12, x + headRx * 0.16, y + lift + tilt * headRy * 0.06);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.08);
    ctx.lineWidth = headRx * 0.02;
    ctx.beginPath();
    ctx.moveTo(x - headRx * 0.13, y + lift - headRy * 0.02);
    ctx.quadraticCurveTo(x, y - headRy * 0.06 + lift, x + headRx * 0.12, y + lift + headRy * 0.008);
    ctx.stroke();
  }

  function drawNose(ctx, cx, cy, headRx, headRy, tone) {
    ctx.strokeStyle = rgba("#8e5f52", 0.36);
    ctx.lineWidth = headRx * 0.025;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + headRx * 0.02, cy - headRy * 0.02);
    ctx.quadraticCurveTo(cx + headRx * 0.03, cy + headRy * 0.10, cx - headRx * 0.02, cy + headRy * 0.18);
    ctx.stroke();

    ctx.strokeStyle = rgba(tone, 0.45);
    ctx.lineWidth = headRx * 0.015;
    ctx.beginPath();
    ctx.moveTo(cx - headRx * 0.04, cy + headRy * 0.15);
    ctx.quadraticCurveTo(cx, cy + headRy * 0.18, cx + headRx * 0.04, cy + headRy * 0.15);
    ctx.stroke();
  }

  function drawCheeks(ctx, cx, cy, headRx, headRy, smile, squint, puff, breath) {
    const warmth = clamp(smile * 0.6 + puff * 0.45 + squint * 0.55, 0, 1);
    const alpha = 0.03 + warmth * 0.07 + breath * 0.01;
    ctx.fillStyle = rgba("#ff8fa0", alpha);
    fillEllipse(ctx, -headRx * 0.58, headRy * 0.20, headRx * 0.28, headRy * 0.16);
    fillEllipse(ctx, headRx * 0.58, headRy * 0.20, headRx * 0.28, headRy * 0.16);
  }

  function drawMouth(ctx, cx, cy, headRx, headRy, jawOpen, smile, frown, pucker, funnel, stretch, press) {

    const mouthX = cx;
    const mouthY = cy + headRy * 0.54 + (frown - smile) * headRy * 0.06;
    const width = headRx * (0.58 + stretch * 0.14 - pucker * 0.18 - funnel * 0.16 - press * 0.08);
    const open = headRy * clamp(0.04 + jawOpen * 0.46 + funnel * 0.12 - press * 0.05, 0.03, 0.34);
    const corner = (smile - frown) * headRy * 0.20;

    // Mouth cavity.
    ctx.fillStyle = "#2a0e17";
    ctx.beginPath();
    ctx.ellipse(mouthX, mouthY + open * 0.04, width * 0.48, open * 0.95, 0, 0, TAU);
    ctx.fill();

    if (jawOpen > 0.08) {
      ctx.fillStyle = "#f2d6c5";
      ctx.beginPath();
      ctx.roundRect(mouthX - width * 0.30, mouthY - open * 0.78, width * 0.60, open * 0.18, open * 0.06);
      ctx.fill();
      ctx.fillStyle = rgba("#d9a99a", 0.55);
      ctx.beginPath();
      ctx.roundRect(mouthX - width * 0.22, mouthY + open * 0.13, width * 0.44, open * 0.16, open * 0.08);
      ctx.fill();
    }

    // Lips.
    ctx.fillStyle = "#8f4251";
    ctx.beginPath();
    ctx.moveTo(mouthX - width * 0.55, mouthY);
    ctx.quadraticCurveTo(mouthX - width * 0.28, mouthY - open * 1.00 - corner, mouthX - width * 0.05, mouthY - open * 0.28 - corner * 0.55);
    ctx.quadraticCurveTo(mouthX + width * 0.16, mouthY - open * 1.05 - corner, mouthX + width * 0.55, mouthY);
    ctx.quadraticCurveTo(mouthX + width * 0.14, mouthY + open * 0.50 + corner * 0.18, mouthX - width * 0.18, mouthY + open * 0.46 + corner * 0.18);
    ctx.quadraticCurveTo(mouthX - width * 0.42, mouthY + open * 0.34 + corner * 0.18, mouthX - width * 0.55, mouthY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgba("#f8d0d2", 0.24);
    ctx.lineWidth = headRx * 0.014;
    ctx.beginPath();
    ctx.moveTo(mouthX - width * 0.40, mouthY - open * 0.05);
    ctx.quadraticCurveTo(mouthX, mouthY + corner * 0.04, mouthX + width * 0.40, mouthY - open * 0.05);
    ctx.stroke();

    // Lower lip highlight.
    ctx.strokeStyle = rgba("#ffd6d8", 0.18);
    ctx.lineWidth = headRx * 0.010;
    ctx.beginPath();
    ctx.moveTo(mouthX - width * 0.30, mouthY + open * 0.26);
    ctx.quadraticCurveTo(mouthX, mouthY + open * 0.44, mouthX + width * 0.30, mouthY + open * 0.26);
    ctx.stroke();
  }

  function drawAvatar(ctx, bs, W, H, options = {}) {
    const state = bs || EMPTY_POSE;
    const background = options.background !== false;
    const headYaw = state.headYaw || 0;
    const headPitch = state.headPitch || 0;
    const headRoll = state.headRoll || 0;
    const breath = state.breath || 0;
    const smile = ((state.mouthSmileLeft || 0) + (state.mouthSmileRight || 0)) * 0.5;
    const frown = ((state.mouthFrownLeft || 0) + (state.mouthFrownRight || 0)) * 0.5;
    const pucker = state.mouthPucker || 0;
    const funnel = state.mouthFunnel || 0;
    const stretch = ((state.mouthStretchLeft || 0) + (state.mouthStretchRight || 0)) * 0.5;
    const press = ((state.mouthPressLeft || 0) + (state.mouthPressRight || 0)) * 0.5;
    const leftEye = {
      blink: state.eyeBlinkLeft || 0,
      wide: state.eyeWideLeft || 0,
    };
    const rightEye = {
      blink: state.eyeBlinkRight || 0,
      wide: state.eyeWideRight || 0,
    };
    const leftGaze = {
      x: ((state.eyeLookOutLeft || 0) - (state.eyeLookInLeft || 0)) + ((state.eyeLookOutRight || 0) - (state.eyeLookInRight || 0)) * 0.14,
      y: ((state.eyeLookUpLeft || 0) - (state.eyeLookDownLeft || 0)) + ((state.eyeLookUpRight || 0) - (state.eyeLookDownRight || 0)) * 0.14,
    };
    const rightGaze = {
      x: ((state.eyeLookInRight || 0) - (state.eyeLookOutRight || 0)) + ((state.eyeLookInLeft || 0) - (state.eyeLookOutLeft || 0)) * 0.14,
      y: ((state.eyeLookUpRight || 0) - (state.eyeLookDownRight || 0)) + ((state.eyeLookUpLeft || 0) - (state.eyeLookDownLeft || 0)) * 0.14,
    };
    const leftBrow = {
      innerUp: state.browInnerUp || 0,
      outerUp: state.browOuterUpLeft || 0,
      down: state.browDownLeft || 0,
    };
    const rightBrow = {
      innerUp: state.browInnerUp || 0,
      outerUp: state.browOuterUpRight || 0,
      down: state.browDownRight || 0,
    };
    const cheekSquint = ((state.cheekSquintLeft || 0) + (state.cheekSquintRight || 0)) * 0.5;
    const cheekPuff = state.cheekPuff || 0;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    if (background) drawBackdrop(ctx, W, H);

    const headRx = W * 0.235;
    const headRy = H * 0.285;
    const cx = W * 0.5 + (headYaw / 30) * W * 0.055;
    const cy = H * 0.47 + (headPitch / 30) * H * 0.045 + breath * H * 0.010;
    const roll = clamp(headRoll, -28, 28) * (Math.PI / 180) * 0.36;

    ctx.translate(cx, cy);
    ctx.rotate(roll);

    drawShoulders(ctx, W, H, breath, smile, cheekSquint + cheekPuff);

    drawHead(ctx, W, H, {
      cx,
      cy,
      headRx,
      headRy,
      jawOpen: state.jawOpen || 0,
      smile,
      frown,
      press,
      pucker,
      funnel,
      stretch,
      leftEye,
      rightEye,
      leftGaze,
      rightGaze,
      leftBrow,
      rightBrow,
      cheekSquint,
      puff: cheekPuff,
    }, breath);

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
