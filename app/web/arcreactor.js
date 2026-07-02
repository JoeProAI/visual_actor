"use strict";

const VisualActorArcReactor = (() => {
  const TAU = Math.PI * 2;
  const CYAN = "#3fd0ff";
  const GOLD = "#ffd45e";
  const BAR_COUNT = 96;
  const WAVE_POINTS = 128;
  const EMPTY_U8 = new Uint8Array(0);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothStep01(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function rgba(hex, alpha) {
    return hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, "0");
  }

  function fillCircle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, TAU);
    ctx.fill();
  }

  function createState() {
    return {
      lastMs: 0,
      activity: 0,
      glow: 0,
      pulse: 0,
      rotation: 0,
      scanPhase: 0,
      barLevels: new Float32Array(BAR_COUNT),
    };
  }

  function getAudioData(audioData) {
    const data = audioData || {};
    return {
      frequency: data.frequency || EMPTY_U8,
      timeDomain: data.timeDomain || EMPTY_U8,
      level: typeof data.level === "number" ? data.level : 0,
      peak: typeof data.peak === "number" ? data.peak : 0,
    };
  }

  function drawScanlines(ctx, W, H, tMs, activity) {
    ctx.save();
    ctx.strokeStyle = rgba("#9be7ff", 0.035 + activity * 0.03);
    ctx.lineWidth = 1;
    const phase = (tMs * 0.025) % 12;
    for (let y = -12 + phase; y < H + 12; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawReticle(ctx, cx, cy, radius, rotation, activity) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation * 0.24);
    ctx.strokeStyle = rgba(CYAN, 0.20 + activity * 0.18);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = rgba(GOLD, 0.18 + activity * 0.16);
    for (let i = 0; i < 12; i++) {
      const angle = rotation + (i / 12) * TAU;
      const inner = radius * 0.92;
      const outer = radius * (i % 3 === 0 ? 1.06 : 1.03);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(CYAN, 0.16 + activity * 0.10);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawSpectrum(ctx, cx, cy, ringRadius, tMs, audio, state) {
    const freq = audio.frequency;
    const barLevels = state.barLevels;
    const freqLen = freq.length;
    const step = freqLen > 0 ? freqLen / BAR_COUNT : 0;
    const levelBoost = 0.14 + state.activity * 0.65;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.rotation * 0.78);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";

    for (let i = 0; i < BAR_COUNT; i++) {
      const idx = freqLen > 0 ? Math.min(freqLen - 1, Math.floor(i * step)) : 0;
      const target = freqLen > 0 ? freq[idx] / 255 : 0;
      barLevels[i] = lerp(barLevels[i], target, 0.14);
      const bar = smoothStep01(barLevels[i] * 0.95 + levelBoost * 0.12);
      const angle = (i / BAR_COUNT) * TAU;
      const inner = ringRadius * 0.96;
      const outer = ringRadius + ringRadius * (0.08 + bar * 0.58 + state.glow * 0.04);
      const color = i % 11 === 0 ? GOLD : CYAN;
      ctx.strokeStyle = rgba(color, 0.28 + bar * 0.62);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawWaveform(ctx, cx, cy, radius, audio, state) {
    const time = audio.timeDomain;
    const len = time.length;
    if (!len) return;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.rotation * 0.16);
    ctx.beginPath();
    for (let i = 0; i < WAVE_POINTS; i++) {
      const idx = Math.min(len - 1, Math.floor((i / WAVE_POINTS) * len));
      const sample = (time[idx] - 128) / 128;
      const ripple = sample * radius * (0.05 + state.activity * 0.22);
      const angle = (i / WAVE_POINTS) * TAU;
      const r = radius + ripple;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(CYAN, 0.42 + state.activity * 0.30);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawCore(ctx, cx, cy, baseRadius, audio, state) {
    const pulse = 0.5 + 0.5 * Math.sin(state.pulse);
    const glow = state.glow;
    const active = state.activity;

    ctx.save();
    ctx.translate(cx, cy);

    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * (2.0 + glow * 1.6));
    bloom.addColorStop(0, rgba(GOLD, 0.22 + active * 0.12));
    bloom.addColorStop(0.22, rgba(CYAN, 0.20 + glow * 0.20));
    bloom.addColorStop(0.55, rgba(CYAN, 0.08));
    bloom.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = bloom;
    fillCircle(ctx, 0, 0, baseRadius * (2.0 + glow * 1.4));

    const outerGlow = ctx.createRadialGradient(0, 0, baseRadius * 0.16, 0, 0, baseRadius * 1.2);
    outerGlow.addColorStop(0, rgba("#ffffff", 0.08 + pulse * 0.05));
    outerGlow.addColorStop(0.25, rgba(CYAN, 0.16 + active * 0.18));
    outerGlow.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = outerGlow;
    fillCircle(ctx, 0, 0, baseRadius * 1.2);

    ctx.rotate(state.rotation * 0.58);
    ctx.strokeStyle = rgba(GOLD, 0.42 + active * 0.18);
    ctx.lineWidth = baseRadius * 0.12;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(0, -baseRadius * 0.92);
    ctx.lineTo(baseRadius * 0.80, baseRadius * 0.46);
    ctx.lineTo(-baseRadius * 0.80, baseRadius * 0.46);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = rgba(CYAN, 0.20 + active * 0.20);
    ctx.beginPath();
    ctx.moveTo(0, -baseRadius * 0.74);
    ctx.lineTo(baseRadius * 0.62, baseRadius * 0.36);
    ctx.lineTo(-baseRadius * 0.62, baseRadius * 0.36);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgba(CYAN, 0.55 + glow * 0.24);
    ctx.lineWidth = baseRadius * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, -baseRadius * 0.48);
    ctx.lineTo(baseRadius * 0.41, baseRadius * 0.24);
    ctx.lineTo(-baseRadius * 0.41, baseRadius * 0.24);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = rgba("#f6fbff", 0.12 + pulse * 0.10);
    fillCircle(ctx, 0, 0, baseRadius * (0.24 + glow * 0.05));

    ctx.fillStyle = rgba(GOLD, 0.24 + active * 0.12);
    fillCircle(ctx, 0, 0, baseRadius * 0.09);

    ctx.restore();
  }

  function drawHud(ctx, cx, cy, radius, state, audio, tMs) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.rotation * -0.28);

    ctx.strokeStyle = rgba(CYAN, 0.14 + state.activity * 0.10);
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * TAU + state.rotation * 0.12;
      const inner = radius * 0.55;
      const outer = radius * (0.70 + (i % 2) * 0.03);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(GOLD, 0.10 + state.activity * 0.06);
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -state.rotation * 36;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = rgba("#ffffff", 0.06 + state.activity * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.30, 0, TAU);
    ctx.stroke();

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = rgba("#b9f0ff", 0.06);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 1.15, cy);
    ctx.lineTo(cx + radius * 1.15, cy);
    ctx.stroke();
    ctx.restore();
  }

  function draw(ctx, W, H, audioData, tMs, state = DEFAULT_STATE) {
    const audio = getAudioData(audioData);
    const dt = state.lastMs ? clamp(tMs - state.lastMs, 0, 48) : 16;
    state.lastMs = tMs;

    const loudness = clamp(audio.level * 1.35 + audio.peak * 0.55, 0, 1);
    state.activity = lerp(state.activity, loudness, 0.12);
    state.glow = lerp(state.glow, state.activity, 0.16);
    state.pulse += dt * (0.0018 + state.activity * 0.0062);
    state.rotation += dt * (0.00022 + state.activity * 0.0010);
    state.scanPhase += dt * 0.03;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const cx = W * 0.5;
    const cy = H * 0.5;
    const size = Math.min(W, H);
    const coreRadius = size * 0.135;
    const ringRadius = size * 0.24;
    const outerRadius = size * 0.40;

    drawScanlines(ctx, W, H, tMs + state.scanPhase, state.activity);
    drawHud(ctx, cx, cy, ringRadius, state, audio, tMs);
    drawReticle(ctx, cx, cy, outerRadius * (0.95 + state.activity * 0.02), state.rotation, state.activity);
    drawSpectrum(ctx, cx, cy, ringRadius * 1.08, tMs, audio, state);
    drawWaveform(ctx, cx, cy, ringRadius * 0.82, audio, state);
    drawCore(ctx, cx, cy, coreRadius, audio, state);

    ctx.restore();
  }

  const DEFAULT_STATE = createState();

  return {
    createState,
    draw,
  };
})();

window.VisualActorArcReactor = VisualActorArcReactor;
