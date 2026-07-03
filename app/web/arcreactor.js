"use strict";

const VisualActorArcReactor = (() => {
  const TAU = Math.PI * 2;
  const CYAN = "#3fd0ff";
  const ICE = "#bfeaff";
  const GOLD = "#ffd45e";
  const AMBER = "#ffb347";
  const BAR_COUNT = 128;
  const WAVE_POINTS = 160;
  const SEGMENTS = 10;
  const PARTICLE_COUNT = 90;
  const ARC_COUNT = 5;
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

  function createParticles() {
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        angle: Math.random() * TAU,
        radius: 0.55 + Math.random() * 0.85,
        speed: (0.00006 + Math.random() * 0.00028) * (Math.random() < 0.5 ? 1 : -1),
        size: 0.4 + Math.random() * 1.8,
        drift: Math.random() * TAU,
        gold: Math.random() < 0.16,
      });
    }
    return particles;
  }

  function createArcs() {
    const arcs = [];
    for (let i = 0; i < ARC_COUNT; i++) {
      arcs.push({ life: 0, maxLife: 0, angle: 0, reach: 0, seed: Math.random() * 1000 });
    }
    return arcs;
  }

  function createState() {
    return {
      lastMs: 0,
      activity: 0,
      glow: 0,
      pulse: 0,
      rotation: 0,
      scanPhase: 0,
      energy: 0,
      barLevels: new Float32Array(BAR_COUNT),
      barPeaks: new Float32Array(BAR_COUNT),
      particles: createParticles(),
      arcs: createArcs(),
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

  // Blend cyan toward gold as the reactor heats up.
  function heatColor(activity) {
    return activity > 0.55 ? GOLD : CYAN;
  }

  function drawBackground(ctx, W, H, tMs, activity) {
    const size = Math.min(W, H);
    ctx.save();

    // Ambient reactor glow filling the frame.
    const ambient = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, size * 0.75);
    ambient.addColorStop(0, rgba("#0d2c40", 0.55 + activity * 0.25));
    ambient.addColorStop(0.5, rgba("#081a29", 0.30));
    ambient.addColorStop(1, rgba("#04090f", 0));
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, W, H);

    // Hex lattice.
    const hexR = Math.max(18, size * 0.045);
    const hexH = hexR * Math.sin(Math.PI / 3);
    ctx.strokeStyle = rgba("#3fa8d8", 0.045 + activity * 0.035);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let row = -1; row * hexH < H + hexR * 2; row++) {
      for (let col = -1; col * hexR * 3 < W + hexR * 3; col++) {
        const x = col * hexR * 3 + (row % 2 ? hexR * 1.5 : 0);
        const y = row * hexH;
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * TAU + Math.PI / 6;
          const px = x + Math.cos(a) * hexR * 0.92;
          const py = y + Math.sin(a) * hexR * 0.92;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
    }
    ctx.stroke();

    // Sweeping scanline band.
    const bandY = ((tMs * 0.04) % (H + size * 0.4)) - size * 0.2;
    const band = ctx.createLinearGradient(0, bandY - size * 0.10, 0, bandY + size * 0.10);
    band.addColorStop(0, rgba(CYAN, 0));
    band.addColorStop(0.5, rgba(CYAN, 0.05 + activity * 0.04));
    band.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - size * 0.10, W, size * 0.20);

    ctx.restore();
  }

  function drawParticles(ctx, cx, cy, baseRadius, dt, state) {
    const active = state.activity;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";
    for (const p of state.particles) {
      p.angle += p.speed * dt * (1 + active * 3.2);
      p.drift += dt * 0.0011;
      const wobble = Math.sin(p.drift) * 0.05;
      const r = baseRadius * (p.radius + wobble + active * 0.06);
      const x = Math.cos(p.angle) * r;
      const y = Math.sin(p.angle) * r;
      const twinkle = 0.5 + 0.5 * Math.sin(p.drift * 3 + p.angle * 2);
      const alpha = (0.10 + twinkle * 0.16) * (0.55 + active * 0.9);
      ctx.fillStyle = rgba(p.gold ? GOLD : ICE, alpha);
      fillCircle(ctx, x, y, p.size * (1 + active * 0.8));
    }
    ctx.restore();
  }

  function drawSegmentRing(ctx, cx, cy, radius, state) {
    const active = state.activity;
    const width = radius * 0.24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.rotation * 0.42);

    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * TAU + 0.05;
      const a1 = ((i + 1) / SEGMENTS) * TAU - 0.05;
      const lit = 0.5 + 0.5 * Math.sin(state.pulse * 1.6 + i * 1.7);
      const alpha = 0.16 + active * 0.30 + lit * 0.12;

      ctx.beginPath();
      ctx.arc(0, 0, radius + width * 0.5, a0, a1);
      ctx.arc(0, 0, radius - width * 0.5, a1, a0, true);
      ctx.closePath();

      const seg = ctx.createRadialGradient(0, 0, radius - width * 0.5, 0, 0, radius + width * 0.5);
      seg.addColorStop(0, rgba("#0c2233", 0.85));
      seg.addColorStop(0.5, rgba("#123448", 0.85));
      seg.addColorStop(1, rgba("#0c2233", 0.85));
      ctx.fillStyle = seg;
      ctx.fill();
      ctx.strokeStyle = rgba(CYAN, alpha);
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Inner glowing filament inside each segment.
      const mid = (a0 + a1) / 2;
      const span = (a1 - a0) * 0.62;
      ctx.strokeStyle = rgba(heatColor(active), 0.22 + lit * 0.30 + active * 0.28);
      ctx.lineWidth = width * 0.28;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, radius, mid - span / 2, mid + span / 2);
      ctx.stroke();
    }

    // Counter-rotating inner ring with tick marks.
    ctx.rotate(-state.rotation * 0.9);
    ctx.strokeStyle = rgba(GOLD, 0.20 + active * 0.18);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      const inner = radius - width * 0.85;
      const outer = inner + (i % 6 === 0 ? width * 0.30 : width * 0.15);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
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
    ctx.setLineDash([14, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Corner brackets sweeping around.
    ctx.strokeStyle = rgba(GOLD, 0.26 + activity * 0.22);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const a = rotation * -0.5 + (i / 4) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.045, a - 0.16, a + 0.16);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(GOLD, 0.18 + activity * 0.16);
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) {
      const angle = rotation + (i / 24) * TAU;
      const inner = radius * 0.94;
      const outer = radius * (i % 4 === 0 ? 1.05 : 1.02);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpectrum(ctx, cx, cy, ringRadius, tMs, audio, state) {
    const freq = audio.frequency;
    const barLevels = state.barLevels;
    const barPeaks = state.barPeaks;
    const freqLen = freq.length;
    const half = BAR_COUNT / 2;
    const step = freqLen > 0 ? (freqLen * 0.72) / half : 0;
    const idleWave = 0.03 + state.activity * 0.02;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.rotation * 0.78 - Math.PI / 2);
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < BAR_COUNT; i++) {
      // Mirror the spectrum: low frequencies at the top, mirrored left/right.
      const bin = i < half ? i : BAR_COUNT - 1 - i;
      const idx = freqLen > 0 ? Math.min(freqLen - 1, Math.floor(bin * step)) : 0;
      const idle = idleWave * (0.5 + 0.5 * Math.sin(tMs * 0.0016 + i * 0.55));
      const target = freqLen > 0 ? Math.max(freq[idx] / 255, idle) : idle;
      barLevels[i] = target > barLevels[i] ? lerp(barLevels[i], target, 0.42) : lerp(barLevels[i], target, 0.10);
      barPeaks[i] = Math.max(barPeaks[i] * 0.985 - 0.002, barLevels[i]);

      const bar = smoothStep01(barLevels[i]);
      const angle = (i / BAR_COUNT) * TAU;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const inner = ringRadius * 1.005;
      const outer = ringRadius * (1.03 + bar * 0.62 + state.glow * 0.05);
      const hot = bar > 0.72;

      ctx.strokeStyle = rgba(hot ? AMBER : CYAN, 0.20 + bar * 0.62);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cosA * inner, sinA * inner);
      ctx.lineTo(cosA * outer, sinA * outer);
      ctx.stroke();

      // Floating peak cap.
      const peakR = ringRadius * (1.05 + smoothStep01(barPeaks[i]) * 0.62);
      ctx.fillStyle = rgba(hot ? GOLD : ICE, 0.35 + bar * 0.4);
      fillCircle(ctx, cosA * peakR, sinA * peakR, 1.3);
    }

    ctx.restore();
  }

  function drawWaveform(ctx, cx, cy, radius, audio, state) {
    const time = audio.timeDomain;
    const len = time.length;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.rotation * 0.16);
    ctx.globalCompositeOperation = "lighter";

    for (const pass of [0, 1]) {
      ctx.beginPath();
      for (let i = 0; i < WAVE_POINTS; i++) {
        const angle = (i / WAVE_POINTS) * TAU;
        let ripple = 0;
        if (len) {
          const idx = Math.min(len - 1, Math.floor((i / WAVE_POINTS) * len));
          const sample = (time[idx] - 128) / 128;
          ripple = sample * radius * (0.06 + state.activity * 0.26);
        } else {
          ripple = Math.sin(angle * 6 + state.pulse * 2) * radius * 0.012;
        }
        const r = radius * (pass === 0 ? 1 : 0.985) + ripple * (pass === 0 ? 1 : -0.7);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = pass === 0
        ? rgba(CYAN, 0.40 + state.activity * 0.32)
        : rgba(GOLD, 0.14 + state.activity * 0.20);
      ctx.lineWidth = pass === 0 ? 2 : 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateArcs(state, dt) {
    for (const arc of state.arcs) {
      if (arc.life > 0) {
        arc.life -= dt;
      } else if (Math.random() < 0.02 + state.activity * 0.12) {
        arc.maxLife = 90 + Math.random() * 160;
        arc.life = arc.maxLife;
        arc.angle = Math.random() * TAU;
        arc.reach = 0.5 + Math.random() * 0.5;
        arc.seed = Math.random() * 1000;
      }
    }
  }

  function drawArcs(ctx, cx, cy, coreRadius, ringRadius, state) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (const arc of state.arcs) {
      if (arc.life <= 0) continue;
      const fade = smoothStep01(arc.life / arc.maxLife);
      const reach = coreRadius + (ringRadius - coreRadius) * arc.reach;
      const steps = 7;
      ctx.beginPath();
      let px = Math.cos(arc.angle) * coreRadius * 0.4;
      let py = Math.sin(arc.angle) * coreRadius * 0.4;
      ctx.moveTo(px, py);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const r = coreRadius * 0.4 + (reach - coreRadius * 0.4) * t;
        const jitter = (s === steps ? 0 : (Math.sin(arc.seed + s * 12.9898 + state.pulse * 9) * 0.5) * coreRadius * 0.34 * (1 - t * 0.5));
        const a = arc.angle + jitter / Math.max(r, 1);
        px = Math.cos(a) * r + Math.sin(arc.seed + s * 78.233 + state.pulse * 7) * coreRadius * 0.10;
        py = Math.sin(a) * r + Math.cos(arc.seed + s * 37.719 + state.pulse * 6) * coreRadius * 0.10;
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(ICE, 0.34 * fade * (0.4 + state.activity));
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = rgba(CYAN, 0.16 * fade);
      ctx.lineWidth = 4.5;
      ctx.stroke();
      ctx.fillStyle = rgba(ICE, 0.5 * fade);
      fillCircle(ctx, px, py, 1.8);
    }
    ctx.restore();
  }

  function drawCore(ctx, cx, cy, baseRadius, audio, state) {
    const pulse = 0.5 + 0.5 * Math.sin(state.pulse);
    const glow = state.glow;
    const active = state.activity;

    ctx.save();
    ctx.translate(cx, cy);

    // Big bloom (additive).
    ctx.globalCompositeOperation = "lighter";
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, baseRadius * (2.2 + glow * 1.8));
    bloom.addColorStop(0, rgba(ICE, 0.20 + active * 0.16));
    bloom.addColorStop(0.20, rgba(CYAN, 0.16 + glow * 0.22));
    bloom.addColorStop(0.55, rgba(CYAN, 0.06));
    bloom.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = bloom;
    fillCircle(ctx, 0, 0, baseRadius * (2.2 + glow * 1.8));
    ctx.globalCompositeOperation = "source-over";

    // Machined housing ring around the core.
    const housing = ctx.createRadialGradient(0, 0, baseRadius * 0.72, 0, 0, baseRadius * 1.05);
    housing.addColorStop(0, "#0a1d2b");
    housing.addColorStop(0.6, "#143850");
    housing.addColorStop(1, "#0a1d2b");
    ctx.strokeStyle = rgba(CYAN, 0.45 + glow * 0.3);
    ctx.lineWidth = 2;
    ctx.fillStyle = housing;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.98, 0, TAU);
    ctx.arc(0, 0, baseRadius * 0.66, 0, TAU, true);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius * 0.98, 0, TAU);
    ctx.stroke();

    // Coil windings across the housing.
    ctx.save();
    ctx.rotate(state.rotation * 0.58);
    ctx.strokeStyle = rgba(GOLD, 0.35 + active * 0.25);
    ctx.lineWidth = baseRadius * 0.055;
    ctx.lineCap = "butt";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * baseRadius * 0.66, Math.sin(a) * baseRadius * 0.66);
      ctx.lineTo(Math.cos(a) * baseRadius * 0.98, Math.sin(a) * baseRadius * 0.98);
      ctx.stroke();
    }
    ctx.restore();

    // Rotating triangle (the classic mark).
    ctx.save();
    ctx.rotate(-state.rotation * 0.42);
    ctx.strokeStyle = rgba(GOLD, 0.40 + active * 0.22);
    ctx.lineWidth = baseRadius * 0.075;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(0, -baseRadius * 0.56);
    ctx.lineTo(baseRadius * 0.485, baseRadius * 0.28);
    ctx.lineTo(-baseRadius * 0.485, baseRadius * 0.28);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = rgba(CYAN, 0.14 + active * 0.18);
    ctx.fill();
    ctx.restore();

    // Plasma heart (additive layers, audio-breathing).
    ctx.globalCompositeOperation = "lighter";
    const heartR = baseRadius * (0.30 + glow * 0.07 + pulse * 0.03);
    const heart = ctx.createRadialGradient(0, 0, 0, 0, 0, heartR);
    heart.addColorStop(0, rgba("#ffffff", 0.75 + pulse * 0.2));
    heart.addColorStop(0.45, rgba(ICE, 0.55 + active * 0.3));
    heart.addColorStop(1, rgba(CYAN, 0));
    ctx.fillStyle = heart;
    fillCircle(ctx, 0, 0, heartR);

    ctx.fillStyle = rgba(heatColor(active), 0.30 + active * 0.25);
    fillCircle(ctx, 0, 0, baseRadius * 0.10);

    ctx.restore();
  }

  function drawHud(ctx, cx, cy, radius, state) {
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

    ctx.strokeStyle = rgba(GOLD, 0.10 + state.activity * 0.08);
    ctx.setLineDash([4, 10]);
    ctx.lineDashOffset = -state.rotation * 36;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.12, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Crosshair axes.
    ctx.save();
    ctx.strokeStyle = rgba("#b9f0ff", 0.06);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - radius * 1.5, cy);
    ctx.lineTo(cx + radius * 1.5, cy);
    ctx.moveTo(cx, cy - radius * 1.5);
    ctx.lineTo(cx, cy + radius * 1.5);
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
    state.rotation += dt * (0.00022 + state.activity * 0.0012);
    state.scanPhase += dt * 0.03;
    updateArcs(state, dt);

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const cx = W * 0.5;
    const cy = H * 0.5;
    const size = Math.min(W, H);
    const coreRadius = size * 0.135;
    const ringRadius = size * 0.24;
    const outerRadius = size * 0.40;

    drawBackground(ctx, W, H, tMs + state.scanPhase, state.activity);
    drawHud(ctx, cx, cy, ringRadius, state);
    drawParticles(ctx, cx, cy, ringRadius, dt, state);
    drawReticle(ctx, cx, cy, outerRadius * (0.95 + state.activity * 0.02), state.rotation, state.activity);
    drawSegmentRing(ctx, cx, cy, ringRadius * 1.32, state);
    drawSpectrum(ctx, cx, cy, ringRadius * 1.08, tMs, audio, state);
    drawWaveform(ctx, cx, cy, ringRadius * 0.82, audio, state);
    drawArcs(ctx, cx, cy, coreRadius, ringRadius * 0.8, state);
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
