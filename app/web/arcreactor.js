"use strict";

const VisualActorArcReactor = (() => {
  const TAU = Math.PI * 2;
  const TEAL = "#3fe0d0";
  const CYAN = "#46c8ff";
  const VIOLET = "#8f6bff";
  const MAGENTA = "#ff5fd2";
  const ICE = "#eafcff";
  const BAR_COUNT = 144;
  const RIBBON_LAYERS = [
    { color: TEAL, scale: 1.0, width: 2.4, phase: 0 },
    { color: VIOLET, scale: 0.86, width: 1.8, phase: 2.1 },
    { color: MAGENTA, scale: 0.72, width: 1.3, phase: 4.2 },
  ];
  const PARTICLE_COUNT = 110;
  const STAR_COUNT = 90;
  const ARC_COUNT = 4;
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
        radius: 0.35 + Math.random() * 1.15,
        speed: (0.00008 + Math.random() * 0.00030) * (Math.random() < 0.35 ? -1 : 1),
        size: 0.4 + Math.random() * 1.9,
        drift: Math.random() * TAU,
        hue: [TEAL, CYAN, VIOLET, MAGENTA][i % 4],
      });
    }
    return particles;
  }

  function createStars() {
    const stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.3 + Math.random() * 1.2,
        twinkle: Math.random() * TAU,
      });
    }
    return stars;
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
      barLevels: new Float32Array(BAR_COUNT),
      barPeaks: new Float32Array(BAR_COUNT),
      particles: createParticles(),
      stars: createStars(),
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

  function drawBackground(ctx, W, H, state) {
    const size = Math.min(W, H);

    // Deep-space nebula wash.
    const nebula = ctx.createRadialGradient(W * 0.5, H * 0.48, 0, W * 0.5, H * 0.48, size * 0.85);
    nebula.addColorStop(0, rgba("#14203d", 0.6 + state.activity * 0.2));
    nebula.addColorStop(0.45, rgba("#0e1330", 0.35));
    nebula.addColorStop(1, rgba("#05070f", 0));
    ctx.fillStyle = nebula;
    ctx.fillRect(0, 0, W, H);

    // Off-center violet bloom for asymmetric depth.
    const tint = ctx.createRadialGradient(W * 0.72, H * 0.30, 0, W * 0.72, H * 0.30, size * 0.55);
    tint.addColorStop(0, rgba(VIOLET, 0.05 + state.activity * 0.05));
    tint.addColorStop(1, rgba(VIOLET, 0));
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, W, H);

    // Twinkling starfield.
    for (const s of state.stars) {
      const tw = 0.5 + 0.5 * Math.sin(state.pulse * 1.4 + s.twinkle);
      ctx.fillStyle = rgba(ICE, 0.10 + tw * 0.22);
      fillCircle(ctx, s.x * W, s.y * H, s.size);
    }
  }

  function drawParticles(ctx, cx, cy, baseRadius, dt, state) {
    const active = state.activity;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";
    for (const p of state.particles) {
      p.angle += p.speed * dt * (1 + active * 3.5);
      p.drift += dt * 0.0012;
      const wobble = Math.sin(p.drift) * 0.06;
      const r = baseRadius * (p.radius + wobble + active * 0.08);
      // Spiral trail: particle plus a fading tail behind its orbit.
      for (let k = 0; k < 3; k++) {
        const a = p.angle - k * 0.05 * (p.speed > 0 ? 1 : -1);
        const twinkle = 0.5 + 0.5 * Math.sin(p.drift * 3 + p.angle * 2);
        const alpha = (0.10 + twinkle * 0.16) * (0.5 + active * 0.9) / (k + 1);
        ctx.fillStyle = rgba(p.hue, alpha);
        fillCircle(ctx, Math.cos(a) * r, Math.sin(a) * r, p.size * (1 + active * 0.7) / (k * 0.6 + 1));
      }
    }
    ctx.restore();
  }

  // Tilted elliptical light orbits with glowing comet heads.
  function drawOrbits(ctx, cx, cy, radius, state) {
    const active = state.activity;
    const orbits = [
      { tilt: 0.42, squash: 0.34, speed: 1.0, color: TEAL },
      { tilt: -0.65, squash: 0.28, speed: -0.72, color: VIOLET },
      { tilt: 1.35, squash: 0.45, speed: 0.55, color: MAGENTA },
    ];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";
    for (const o of orbits) {
      ctx.save();
      ctx.rotate(o.tilt + state.rotation * 0.08 * o.speed);
      ctx.scale(1, o.squash);

      ctx.strokeStyle = rgba(o.color, 0.12 + active * 0.14);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();

      // Comet head + tapering tail sweeping along the orbit.
      const head = state.rotation * 1.6 * o.speed;
      for (let k = 0; k < 14; k++) {
        const a = head - k * 0.055 * Math.sign(o.speed);
        const fade = 1 - k / 14;
        ctx.fillStyle = rgba(o.color, (0.5 + active * 0.4) * fade * fade);
        fillCircle(ctx, Math.cos(a) * radius, Math.sin(a) * radius, (3.2 - k * 0.18) * (1 + active * 0.5));
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // Audio-sculpted silk ribbons: smooth closed curves whose radius follows the
  // spectrum, layered in shifted hues.
  function drawRibbons(ctx, cx, cy, baseRadius, tMs, audio, state) {
    const freq = audio.frequency;
    const freqLen = freq.length;
    const half = BAR_COUNT / 2;
    const step = freqLen > 0 ? (freqLen * 0.70) / half : 0;
    const idleWave = 0.05 + state.activity * 0.02;
    const barLevels = state.barLevels;
    const barPeaks = state.barPeaks;

    for (let i = 0; i < BAR_COUNT; i++) {
      const bin = i < half ? i : BAR_COUNT - 1 - i;
      const idx = freqLen > 0 ? Math.min(freqLen - 1, Math.floor(bin * step)) : 0;
      const idle = idleWave * (0.5 + 0.5 * Math.sin(tMs * 0.0014 + i * 0.42));
      const target = freqLen > 0 ? Math.max(freq[idx] / 255, idle) : idle;
      barLevels[i] = target > barLevels[i] ? lerp(barLevels[i], target, 0.40) : lerp(barLevels[i], target, 0.085);
      barPeaks[i] = Math.max(barPeaks[i] * 0.986 - 0.002, barLevels[i]);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";

    for (const layer of RIBBON_LAYERS) {
      ctx.save();
      ctx.rotate(state.rotation * 0.35 + layer.phase);
      ctx.beginPath();
      for (let i = 0; i <= BAR_COUNT; i++) {
        const j = i % BAR_COUNT;
        const angle = (i / BAR_COUNT) * TAU;
        const bar = smoothStep01(barLevels[j]);
        const flutter = Math.sin(angle * 5 + state.pulse * 2 + layer.phase) * 0.015;
        const r = baseRadius * layer.scale * (1 + flutter) + baseRadius * bar * 0.55 * layer.scale;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(layer.color, 0.30 + state.activity * 0.40);
      ctx.lineWidth = layer.width;
      ctx.stroke();

      // Soft inner fill so ribbons read as glowing veils, not wireframes.
      const veil = ctx.createRadialGradient(0, 0, baseRadius * layer.scale * 0.4, 0, 0, baseRadius * layer.scale * 1.4);
      veil.addColorStop(0, rgba(layer.color, 0));
      veil.addColorStop(0.85, rgba(layer.color, 0.035 + state.activity * 0.05));
      veil.addColorStop(1, rgba(layer.color, 0));
      ctx.fillStyle = veil;
      ctx.fill();
      ctx.restore();
    }

    // Floating peak sparks above the outer ribbon.
    ctx.rotate(state.rotation * 0.35);
    for (let i = 0; i < BAR_COUNT; i += 3) {
      const angle = (i / BAR_COUNT) * TAU;
      const peak = smoothStep01(barPeaks[i]);
      if (peak < 0.08) continue;
      const r = baseRadius * (1.06 + peak * 0.55);
      ctx.fillStyle = rgba(ICE, 0.25 + peak * 0.45);
      fillCircle(ctx, Math.cos(angle) * r, Math.sin(angle) * r, 1.2);
    }
    ctx.restore();
  }

  function updateArcs(state, dt) {
    for (const arc of state.arcs) {
      if (arc.life > 0) {
        arc.life -= dt;
      } else if (Math.random() < 0.015 + state.activity * 0.10) {
        arc.maxLife = 100 + Math.random() * 180;
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
        const a = arc.angle + Math.sin(arc.seed + s * 12.9898 + state.pulse * 9) * 0.16 * (1 - t * 0.5);
        px = Math.cos(a) * r + Math.sin(arc.seed + s * 78.233 + state.pulse * 7) * coreRadius * 0.10;
        py = Math.sin(a) * r + Math.cos(arc.seed + s * 37.719 + state.pulse * 6) * coreRadius * 0.10;
        ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgba(ICE, 0.30 * fade * (0.4 + state.activity));
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.strokeStyle = rgba(VIOLET, 0.16 * fade);
      ctx.lineWidth = 4.2;
      ctx.stroke();
      ctx.fillStyle = rgba(ICE, 0.5 * fade);
      fillCircle(ctx, px, py, 1.8);
    }
    ctx.restore();
  }

  // Aurora plasma heart: layered additive gradients that breathe with audio.
  function drawCore(ctx, cx, cy, baseRadius, state) {
    const pulse = 0.5 + 0.5 * Math.sin(state.pulse);
    const glow = state.glow;
    const active = state.activity;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "lighter";

    const bloomR = baseRadius * (2.4 + glow * 2.0);
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomR);
    bloom.addColorStop(0, rgba(ICE, 0.18 + active * 0.14));
    bloom.addColorStop(0.22, rgba(TEAL, 0.14 + glow * 0.20));
    bloom.addColorStop(0.55, rgba(VIOLET, 0.06 + glow * 0.08));
    bloom.addColorStop(1, rgba(MAGENTA, 0));
    ctx.fillStyle = bloom;
    fillCircle(ctx, 0, 0, bloomR);

    // Swirling aurora lobes orbiting inside the heart.
    for (let k = 0; k < 3; k++) {
      const a = state.rotation * (0.9 + k * 0.35) + (k / 3) * TAU;
      const d = baseRadius * (0.28 + 0.10 * Math.sin(state.pulse * 1.3 + k * 2));
      const lx = Math.cos(a) * d;
      const ly = Math.sin(a) * d;
      const lobeR = baseRadius * (0.55 + active * 0.20);
      const lobe = ctx.createRadialGradient(lx, ly, 0, lx, ly, lobeR);
      const hue = [TEAL, VIOLET, MAGENTA][k];
      lobe.addColorStop(0, rgba(hue, 0.22 + active * 0.20));
      lobe.addColorStop(1, rgba(hue, 0));
      ctx.fillStyle = lobe;
      fillCircle(ctx, lx, ly, lobeR);
    }

    // White-hot nucleus.
    const heartR = baseRadius * (0.34 + glow * 0.08 + pulse * 0.03);
    const heart = ctx.createRadialGradient(0, 0, 0, 0, 0, heartR);
    heart.addColorStop(0, rgba("#ffffff", 0.85));
    heart.addColorStop(0.5, rgba(ICE, 0.45 + active * 0.30));
    heart.addColorStop(1, rgba(TEAL, 0));
    ctx.fillStyle = heart;
    fillCircle(ctx, 0, 0, heartR);

    // Lens-flare cross that flares up on loud peaks.
    const flare = 0.10 + active * 0.5;
    const flareLen = baseRadius * (1.6 + active * 1.6);
    for (const rot of [0, Math.PI / 2]) {
      const g = ctx.createLinearGradient(-flareLen, 0, flareLen, 0);
      g.addColorStop(0, rgba(ICE, 0));
      g.addColorStop(0.5, rgba(ICE, flare));
      g.addColorStop(1, rgba(ICE, 0));
      ctx.save();
      ctx.rotate(rot + state.rotation * 0.05);
      ctx.fillStyle = g;
      ctx.fillRect(-flareLen, -1.1, flareLen * 2, 2.2);
      ctx.restore();
    }

    ctx.restore();
  }

  function draw(ctx, W, H, audioData, tMs, state = DEFAULT_STATE) {
    const audio = getAudioData(audioData);
    const dt = state.lastMs ? clamp(tMs - state.lastMs, 0, 48) : 16;
    state.lastMs = tMs;

    const loudness = clamp(audio.level * 1.35 + audio.peak * 0.55, 0, 1);
    state.activity = lerp(state.activity, loudness, 0.12);
    state.glow = lerp(state.glow, state.activity, 0.16);
    state.pulse += dt * (0.0018 + state.activity * 0.0058);
    state.rotation += dt * (0.00024 + state.activity * 0.0011);
    updateArcs(state, dt);

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const cx = W * 0.5;
    const cy = H * 0.5;
    const size = Math.min(W, H);
    const coreRadius = size * 0.12;
    const ribbonRadius = size * 0.235;
    const orbitRadius = size * 0.36;

    drawBackground(ctx, W, H, state);
    drawParticles(ctx, cx, cy, ribbonRadius, dt, state);
    drawOrbits(ctx, cx, cy, orbitRadius, state);
    drawRibbons(ctx, cx, cy, ribbonRadius, tMs, audio, state);
    drawArcs(ctx, cx, cy, coreRadius, ribbonRadius * 0.85, state);
    drawCore(ctx, cx, cy, coreRadius, state);

    ctx.restore();
  }

  const DEFAULT_STATE = createState();

  return {
    createState,
    draw,
  };
})();

window.VisualActorArcReactor = VisualActorArcReactor;
