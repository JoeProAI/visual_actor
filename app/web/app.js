"use strict";

const Avatar = window.VisualActorAvatar;
const ArcReactor = window.VisualActorArcReactor;
const Avatar3D = window.VisualActorAvatar3D;
const canvas = document.getElementById("avatar");
const canvas3d = document.getElementById("avatar3d");
const ctx = canvas.getContext("2d");
const statusPill = document.getElementById("status-pill");
const connectionHint = document.getElementById("connection-hint");
const providerBadge = document.getElementById("provider-badge");
const hudFps = document.getElementById("hud-fps");
const hudProvider = document.getElementById("hud-provider");
const verdictPill = document.getElementById("verdict-pill");
const reportBody = document.getElementById("report-body");
const input = document.getElementById("text");
const speakButton = document.getElementById("say");
const modeFaceButton = document.getElementById("mode-face");
const modeReactorButton = document.getElementById("mode-reactor");

function decodePcmBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

function resizeCanvasToDisplaySize(canvasEl) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvasEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
    return true;
  }
  return false;
}

function metricLabel(name) {
  const labels = {
    total_first_visible_frame_ms: "First visible frame",
    first_audio_chunk_ms: "First audio chunk",
    first_mouth_motion_ms: "First mouth motion",
    audio_mouth_sync_offset_ms: "Audio↔mouth sync",
  };
  return labels[name] || name.replaceAll("_", " ");
}

function formatMs(value) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)} ms`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothStep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function mixPose(dst, a, b, t) {
  const u = 1 - t;
  const keys = Avatar.BLEND_KEYS;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    dst[key] = a[key] * u + b[key] * t;
  }
  return dst;
}

class IdleAnimator {
  constructor(basePose) {
    this.basePose = basePose;
    this.idlePose = Avatar.createIdlePose();
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.phaseA = this.nextPhase();
    this.phaseB = this.nextPhase();
    this.phaseC = this.nextPhase();
    this.phaseD = this.nextPhase();
    this.phaseE = this.nextPhase();
    this.phaseF = this.nextPhase();
    this.phaseG = this.nextPhase();
    this.nextBlinkAt = 0;
    this.blinkStartAt = 0;
    this.blinkCount = 0;
    this.blinking = false;
    this.gazeState = "hold";
    this.gazeStartAt = 0;
    this.gazeEndAt = 0;
    this.gazeHoldUntil = 0;
    this.gazeRestUntil = 0;
    this.gazeFromX = 0;
    this.gazeFromY = 0;
    this.gazeTargetX = 0;
    this.gazeTargetY = 0;
    this.gazeCurrentX = 0;
    this.gazeCurrentY = 0;
    this.gazeMoveDuration = 160;
    this.gazeHoldDuration = 280;
    this.idlePose.headYaw = 0;
    this.idlePose.headPitch = 0;
    this.idlePose.headRoll = 0;
    this.scheduleNextBlink(performance.now());
    this.scheduleNextGaze(performance.now(), true);
  }

  nextPhase() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) / 0xffffffff) * Math.PI * 2;
  }

  rand() {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 0xffffffff;
  }

  range(min, max) {
    return lerp(min, max, this.rand());
  }

  scheduleNextBlink(now) {
    this.nextBlinkAt = now + this.range(2100, 5600);
    this.blinkCount = this.rand() < 0.22 ? 2 : 1;
    this.blinking = false;
    this.blinkStartAt = 0;
  }

  scheduleNextGaze(now, immediate = false) {
    const amplitude = this.rand() < 0.08 ? 0.11 : 0.07;
    this.gazeFromX = immediate ? this.gazeCurrentX : this.gazeTargetX;
    this.gazeFromY = immediate ? this.gazeCurrentY : this.gazeTargetY;
    this.gazeTargetX = (this.rand() * 2 - 1) * amplitude;
    this.gazeTargetY = (this.rand() * 2 - 1) * (amplitude * 0.65);
    this.gazeMoveDuration = this.range(90, 150);
    this.gazeHoldDuration = this.range(220, 980);
    this.gazeStartAt = now + this.range(180, 520);
    this.gazeEndAt = this.gazeStartAt + this.gazeMoveDuration;
    this.gazeHoldUntil = this.gazeEndAt + this.gazeHoldDuration;
    this.gazeRestUntil = this.gazeHoldUntil + this.range(120, 380);
    this.gazeState = "hold";
  }

  updateBlink(now) {
    if (!this.blinking && now >= this.nextBlinkAt) {
      this.blinking = true;
      this.blinkStartAt = now;
    }

    if (!this.blinking) {
      return 0;
    }

    const closeMs = 62;
    const holdMs = 28;
    const openMs = 110;
    const elapsed = now - this.blinkStartAt;
    const total = closeMs + holdMs + openMs;

    if (elapsed <= closeMs) {
      return smoothStep01(elapsed / closeMs);
    }
    if (elapsed <= closeMs + holdMs) {
      return 1;
    }
    if (elapsed <= total) {
      return 1 - smoothStep01((elapsed - closeMs - holdMs) / openMs);
    }

    if (this.blinkCount > 1) {
      this.blinkCount -= 1;
      this.blinkStartAt = now + this.range(85, 180);
      return 0;
    }

    this.scheduleNextBlink(now);
    return 0;
  }

  updateGaze(now) {
    if (this.gazeState === "hold") {
      if (now < this.gazeStartAt) {
        this.gazeCurrentX = 0;
        this.gazeCurrentY = 0;
        return;
      }
      this.gazeState = "move";
      this.gazeCurrentX = this.gazeFromX;
      this.gazeCurrentY = this.gazeFromY;
    }

    if (this.gazeState === "move") {
      const t = smoothStep01((now - this.gazeStartAt) / this.gazeMoveDuration);
      this.gazeCurrentX = lerp(this.gazeFromX, this.gazeTargetX, t);
      this.gazeCurrentY = lerp(this.gazeFromY, this.gazeTargetY, t);
      if (now >= this.gazeEndAt) {
        this.gazeState = "holdTarget";
      }
    }

    if (this.gazeState === "holdTarget") {
      this.gazeCurrentX = this.gazeTargetX;
      this.gazeCurrentY = this.gazeTargetY;
      if (now >= this.gazeHoldUntil) {
        this.gazeState = "return";
        this.gazeFromX = this.gazeCurrentX;
        this.gazeFromY = this.gazeCurrentY;
        this.gazeStartAt = now;
        this.gazeEndAt = now + this.range(120, 200);
      }
    }

    if (this.gazeState === "return") {
      const t = smoothStep01((now - this.gazeStartAt) / Math.max(1, this.gazeEndAt - this.gazeStartAt));
      this.gazeCurrentX = lerp(this.gazeFromX, 0, t);
      this.gazeCurrentY = lerp(this.gazeFromY, 0, t);
      if (now >= this.gazeEndAt) {
        this.gazeState = "hold";
        this.gazeFromX = this.gazeCurrentX = 0;
        this.gazeFromY = this.gazeCurrentY = 0;
        this.scheduleNextGaze(now, false);
      }
    }

    return;
  }

  sample(now, out) {
    Avatar.copyPose(out, this.basePose);

    const t = now * 0.001;
    const breath = 0.14 + 0.03 * Math.sin(t * 1.05 + this.phaseA) + 0.012 * Math.sin(t * 2.1 + this.phaseB);
    const driftYaw = 0.85 * Math.sin(t * 0.18 + this.phaseC) + 0.35 * Math.sin(t * 0.37 + this.phaseD);
    const driftPitch = 0.55 * Math.sin(t * 0.21 + this.phaseE) + 0.22 * Math.sin(t * 0.49 + this.phaseF);
    const driftRoll = 0.32 * Math.sin(t * 0.15 + this.phaseG) + 0.12 * Math.sin(t * 0.32 + this.phaseA * 0.5);
    const blink = this.updateBlink(now);
    this.updateGaze(now);
    const saccadeX = this.gazeCurrentX;
    const saccadeY = this.gazeCurrentY;

    out.breath = breath;
    out.headYaw = driftYaw;
    out.headPitch = driftPitch + breath * 0.45;
    out.headRoll = driftRoll;

    out.eyeBlinkLeft = blink;
    out.eyeBlinkRight = blink;
    out.eyeWideLeft = this.basePose.eyeWideLeft + 0.02 * Math.sin(t * 0.9 + this.phaseB);
    out.eyeWideRight = this.basePose.eyeWideRight + 0.02 * Math.sin(t * 0.87 + this.phaseC);

    const gazeX = saccadeX;
    const gazeY = saccadeY;
    out.eyeLookOutLeft = Math.max(0, gazeX);
    out.eyeLookInLeft = Math.max(0, -gazeX);
    out.eyeLookOutRight = Math.max(0, -gazeX);
    out.eyeLookInRight = Math.max(0, gazeX);
    out.eyeLookUpLeft = Math.max(0, gazeY);
    out.eyeLookDownLeft = Math.max(0, -gazeY);
    out.eyeLookUpRight = Math.max(0, gazeY);
    out.eyeLookDownRight = Math.max(0, -gazeY);

    out.browInnerUp = this.basePose.browInnerUp + 0.01 * Math.sin(t * 0.7 + this.phaseD);
    out.browOuterUpLeft = this.basePose.browOuterUpLeft + 0.012 * Math.sin(t * 0.64 + this.phaseE);
    out.browOuterUpRight = this.basePose.browOuterUpRight + 0.012 * Math.sin(t * 0.66 + this.phaseF);
    out.browDownLeft = 0.01 * Math.max(0, Math.sin(t * 0.41 + this.phaseG));
    out.browDownRight = 0.01 * Math.max(0, Math.sin(t * 0.39 + this.phaseA));

    out.cheekSquintLeft = this.basePose.cheekSquintLeft + 0.015 * Math.max(0, Math.sin(t * 0.82 + this.phaseB));
    out.cheekSquintRight = this.basePose.cheekSquintRight + 0.015 * Math.max(0, Math.sin(t * 0.85 + this.phaseC));
    out.cheekPuff = this.basePose.cheekPuff + 0.01 * Math.max(0, Math.sin(t * 0.54 + this.phaseD));

    return out;
  }
}

function renderReport(report) {
  if (!report) {
    reportBody.innerHTML = '<tr class="empty"><td colspan="4">No timing report yet. Say a line to generate one.</td></tr>';
    verdictPill.textContent = "Waiting";
    verdictPill.dataset.state = "neutral";
    verdictPill.className = "verdict-pill neutral";
    return;
  }

  const grade = report?.grade || {};
  const rows = [];
  for (const [metric, item] of Object.entries(grade)) {
    const state = item.pass === true ? "pass" : item.pass === false ? "fail" : "neutral";
    const verdict = item.pass === true ? "PASS" : item.pass === false ? "FAIL" : "—";
    rows.push(`
      <tr class="${state}">
        <th scope="row">${metricLabel(metric)}</th>
        <td>${formatMs(item.value)}</td>
        <td>${formatMs(item.target)}</td>
        <td><span class="metric-pill ${state}">${verdict}</span></td>
      </tr>
    `);
  }
  reportBody.innerHTML = rows.length
    ? rows.join("")
    : '<tr class="empty"><td colspan="4">No timing report yet. Say a line to generate one.</td></tr>';

  const passed = Boolean(report?.passed);
  verdictPill.textContent = passed ? "PASS" : "FAIL";
  verdictPill.dataset.state = passed ? "pass" : "fail";
  verdictPill.className = `verdict-pill ${passed ? "pass" : "fail"}`;
}

class AudioPlayer {
  constructor(onStart) {
    this.ctx = null;
    this.analyser = null;
    this.nextTime = 0;
    this.started = false;
    this.onStart = onStart;
    this.freqData = new Uint8Array(0);
    this.timeData = new Uint8Array(0);
    this.visualData = {
      frequency: this.freqData,
      timeDomain: this.timeData,
      level: 0,
      peak: 0,
      active: false,
    };
  }

  ensure(sampleRate) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
      this.nextTime = this.ctx.currentTime;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.84;
      this.analyser.connect(this.ctx.destination);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.visualData.frequency = this.freqData;
      this.visualData.timeDomain = this.timeData;
    }
  }

  play(int16, sampleRate) {
    if (!int16.length) return;
    this.ensure(sampleRate);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buffer = this.ctx.createBuffer(1, f32.length, sampleRate);
    buffer.copyToChannel(f32, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser || this.ctx.destination);
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    const start = Math.max(this.ctx.currentTime, this.nextTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
    if (!this.started) {
      this.started = true;
      if (this.onStart) this.onStart();
    }
  }

  sample() {
    if (!this.analyser) {
      this.visualData.level = 0;
      this.visualData.peak = 0;
      this.visualData.active = false;
      return this.visualData;
    }

    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      const value = this.freqData[i];
      sum += value;
      if (value > peak) peak = value;
    }
    const level = this.freqData.length ? sum / (this.freqData.length * 255) : 0;
    this.visualData.level = level;
    this.visualData.peak = peak / 255;
    this.visualData.active = level > 0.02 || this.visualData.peak > 0.03;
    return this.visualData;
  }

  reset() {
    this.started = false;
    if (this.ctx) this.nextTime = this.ctx.currentTime;
  }
}

class VisualActorClient {
  constructor() {
    this.serverPose = Avatar.createIdlePose();
    this.idleBasePose = Avatar.createIdlePose();
    this.idlePose = Avatar.createIdlePose();
    this.transitionPose = Avatar.createIdlePose();
    this.renderPose = Avatar.createIdlePose();
    this.idleAnimator = new IdleAnimator(this.idleBasePose);
    this.ws = null;
    this.connected = false;
    this.busy = false;
    this.sessionActive = false;
    this.idleTransitionAt = 0;
    this.idleTransitionMs = 420;
    this.firstFrameTelemetrySent = false;
    this.audioStartedTelemetrySent = false;
    this.provider = "—";
    this.reconnectTimer = 0;
    this.fps = 0;
    this.lastTick = 0;
    this.visualMode = "face";
    this.reactorState = ArcReactor.createState();
    this.viewer3d = null;
    Avatar3D.load(canvas3d)
      .then((viewer) => {
        this.viewer3d = viewer;
      })
      .catch(() => {
        this.viewer3d = null;
      });
    this.audio = new AudioPlayer(() => this.sendTelemetry("audio_playback_start"));

    try {
      const storedMode = window.localStorage.getItem("visual-actor-stage-mode");
      if (storedMode === "face" || storedMode === "reactor") this.visualMode = storedMode;
    } catch (_) {
      this.visualMode = "face";
    }

    this.setStatus("connecting", "Connecting…", "Opening live socket…");
    renderReport(null);
    this.updateProviderLabels();
    this.updateSpeakButton();
    this.updateModeButtons();

    speakButton.addEventListener("click", () => this.say());
    modeFaceButton.addEventListener("click", () => this.setVisualMode("face"));
    modeReactorButton.addEventListener("click", () => this.setVisualMode("reactor"));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.say();
    });

    window.addEventListener("resize", () => resizeCanvasToDisplaySize(canvas));
    this.connect();
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  beginIdleTransition(now) {
    Avatar.copyPose(this.transitionPose, this.renderPose);
    this.idleTransitionAt = now;
  }

  setVisualMode(mode) {
    if (mode !== "face" && mode !== "reactor") return;
    this.visualMode = mode;
    this.updateModeButtons();
    try {
      window.localStorage.setItem("visual-actor-stage-mode", mode);
    } catch (_) {
      // ignore storage errors
    }
  }

  updateModeButtons() {
    const faceActive = this.visualMode === "face";
    modeFaceButton.setAttribute("aria-pressed", faceActive ? "true" : "false");
    modeReactorButton.setAttribute("aria-pressed", faceActive ? "false" : "true");
  }

  setStatus(state, text, hint) {
    statusPill.dataset.state = state;
    statusPill.textContent = text;
    connectionHint.textContent = hint;
  }

  updateProviderLabels() {
    providerBadge.textContent = `provider: ${this.provider}`;
    hudProvider.textContent = this.provider;
  }

  updateSpeakButton() {
    speakButton.disabled = !this.connected || this.busy;
    speakButton.textContent = this.busy ? "Speaking…" : "Speak";
    speakButton.dataset.state = this.busy ? "busy" : this.connected ? "ready" : "offline";
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = 0;
      this.connect();
    }, 1500);
  }

  connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.setStatus("connecting", "Connecting…", "Opening live socket…");
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);

    this.ws.onopen = () => {
      this.connected = true;
      this.setStatus("ready", "Ready", "Live stream connected.");
      this.updateSpeakButton();
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.finishSession(performance.now());
      this.setStatus("disconnected", "Disconnected", "Reconnecting…");
      this.updateSpeakButton();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
      this.setStatus("disconnected", "Disconnected", "Connection error. Reconnecting…");
      this.updateSpeakButton();
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "frame":
          Avatar.copyPose(this.serverPose, msg.blendshapes);
          if (this.sessionActive && !this.firstFrameTelemetrySent) {
            this.firstFrameTelemetrySent = true;
            this.sendTelemetry("first_frame_displayed");
          }
          break;
        case "audio":
          this.audio.play(decodePcmBase64(msg.pcm), msg.sample_rate);
          break;
        case "provider":
          this.provider = msg.name || "—";
          this.updateProviderLabels();
          break;
        case "report":
          if (msg.provider) {
            this.provider = msg.provider;
            this.updateProviderLabels();
          }
          renderReport(msg);
          this.finishSession(performance.now());
          this.setStatus("ready", "Ready", "Live stream connected.");
          this.updateSpeakButton();
          break;
        case "pong":
          break;
        case "error":
          this.setStatus("disconnected", "Disconnected", msg.message || "Server error");
          this.finishSession();
          this.updateSpeakButton();
          break;
        default:
          break;
      }
    };
  }

  finishSession(now = performance.now()) {
    this.beginIdleTransition(now);
    this.busy = false;
    this.sessionActive = false;
    this.firstFrameTelemetrySent = false;
    this.audioStartedTelemetrySent = false;
    this.audio.reset();
    this.updateSpeakButton();
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendTelemetry(event) {
    if (!this.sessionActive) return;
    if (event === "audio_playback_start") {
      if (this.audioStartedTelemetrySent) return;
      this.audioStartedTelemetrySent = true;
    }
    this.send({ type: "telemetry", event, t_ms: performance.now() });
  }

  say() {
    const text = input.value.trim();
    if (!text || !this.connected || this.busy) return;
    this.busy = true;
    this.sessionActive = true;
    this.idleTransitionAt = 0;
    this.firstFrameTelemetrySent = false;
    this.audioStartedTelemetrySent = false;
    this.audio.reset();
    this.updateSpeakButton();
    this.send({ type: "say", text });
  }

  renderLoop(timestamp) {
    resizeCanvasToDisplaySize(canvas);
    const now = performance.now();
    const audioData = this.audio.sample();
    const use3d = this.visualMode === "face" && this.viewer3d;
    canvas3d.style.display = use3d ? "block" : "none";
    if (this.visualMode === "reactor") {
      ArcReactor.draw(ctx, canvas.width, canvas.height, audioData, now, this.reactorState);
    } else {
      const idlePose = this.idleAnimator.sample(now, this.idlePose);
      if (this.busy || this.sessionActive) {
        Avatar.copyPose(this.renderPose, this.serverPose);
      } else if (this.idleTransitionAt) {
        const t = Math.min(1, (now - this.idleTransitionAt) / this.idleTransitionMs);
        mixPose(this.renderPose, this.transitionPose, idlePose, smoothStep01(t));
        if (t >= 1) {
          this.idleTransitionAt = 0;
        }
      } else {
        Avatar.copyPose(this.renderPose, idlePose);
      }
      if (use3d) {
        this.viewer3d.resize(canvas.width, canvas.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.viewer3d.render(this.renderPose, audioData.level, now);
      } else {
        Avatar.drawAvatar(ctx, this.renderPose, canvas.width, canvas.height, { background: true });
      }
    }

    if (this.lastTick) {
      const fpsInstant = 1000 / Math.max(1, timestamp - this.lastTick);
      this.fps = this.fps ? this.fps * 0.9 + fpsInstant * 0.1 : fpsInstant;
      hudFps.textContent = `${Math.round(this.fps)} fps`;
    }
    this.lastTick = timestamp;
    requestAnimationFrame((t) => this.renderLoop(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new VisualActorClient();
});
