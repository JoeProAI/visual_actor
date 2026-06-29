// Visual Actor web client.
// Renders the avatar from streamed blendshape state on a <canvas> (the "live
// camera feed") and plays streamed PCM audio via WebAudio, keeping both aligned
// to the server's shared clock. Reports browser display telemetry back.

"use strict";

// ---- Canvas avatar renderer (mirrors app/avatar/renderer.py) -------------- //
function drawAvatar(ctx, bs, W, H) {
  const dx = (bs.headYaw / 30) * W * 0.04;
  const dy = (bs.headPitch / 30) * H * 0.03 - (bs.breath || 0) * H * 0.01;

  ctx.fillStyle = "#12131c";
  ctx.fillRect(0, 0, W, H);

  // Head
  const cx = 0.5 * W + dx, cy = 0.46 * H + dy;
  ctx.fillStyle = "#e8c6ae";
  ellipse(ctx, cx, cy, 0.30 * W, 0.34 * H);

  // Eyes
  drawEye(ctx, 0.38 * W + dx, 0.40 * H + dy, bs.eyeBlinkLeft, bs.eyeWideLeft,
          (bs.eyeLookOutLeft || 0) - (bs.eyeLookInLeft || 0),
          (bs.eyeLookUpLeft || 0) - (bs.eyeLookDownLeft || 0), W, H);
  drawEye(ctx, 0.62 * W + dx, 0.40 * H + dy, bs.eyeBlinkRight, bs.eyeWideRight,
          (bs.eyeLookInRight || 0) - (bs.eyeLookOutRight || 0),
          (bs.eyeLookUpRight || 0) - (bs.eyeLookDownRight || 0), W, H);

  // Brows
  ctx.fillStyle = "#5a463c";
  const browL = (bs.browOuterUpLeft || 0) + (bs.browInnerUp || 0);
  const browR = (bs.browOuterUpRight || 0) + (bs.browInnerUp || 0);
  ellipse(ctx, 0.38 * W + dx, 0.40 * H + dy - H * (0.04 + 0.02 * browL), 0.06 * W, 0.008 * H);
  ellipse(ctx, 0.62 * W + dx, 0.40 * H + dy - H * (0.04 + 0.02 * browR), 0.06 * W, 0.008 * H);

  // Mouth
  const smile = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) * 0.5;
  const widthScale = 1 + 0.4 * smile - 0.5 * (bs.mouthPucker || 0) - 0.3 * (bs.mouthFunnel || 0);
  const mrx = Math.max(2, 0.10 * W * widthScale);
  const mry = Math.max(1, H * (0.012 + 0.09 * (bs.jawOpen || 0)));
  const mx = 0.5 * W + dx, my = 0.66 * H + dy - smile * H * 0.01;
  ctx.fillStyle = "#78323c";
  ellipse(ctx, mx, my, mrx, mry);
  if ((bs.jawOpen || 0) > 0.1) {
    ctx.fillStyle = "#3c141e";
    ellipse(ctx, mx, my, mrx * 0.8, mry * 0.7);
  }
}

function ellipse(ctx, cx, cy, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEye(ctx, ex, ey, blink, wide, lookX, lookY, W, H) {
  const open = (1 - (blink || 0)) * (1 + 0.4 * (wide || 0));
  const ery = Math.max(0.5, H * 0.022 * open), erx = W * 0.05;
  ctx.fillStyle = "#fafafc";
  ellipse(ctx, ex, ey, erx, ery);
  if (open > 0.15) {
    ctx.fillStyle = "#28283c";
    ellipse(ctx, ex + lookX * erx * 0.5, ey - lookY * ery * 0.6, erx * 0.4, ery * 0.6);
  }
}

// ---- Audio playback (scheduled, gapless) ---------------------------------- //
class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.nextTime = 0;
    this.started = false;
    this.onStart = null;
  }
  ensure(sampleRate) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
      this.nextTime = this.ctx.currentTime;
    }
  }
  play(int16, sampleRate) {
    this.ensure(sampleRate);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    if (f32.length === 0) return;
    const buf = this.ctx.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const t = Math.max(this.ctx.currentTime, this.nextTime);
    src.start(t);
    this.nextTime = t + buf.duration;
    if (!this.started) {
      this.started = true;
      if (this.onStart) this.onStart(performance.now());
    }
  }
  reset() { this.started = false; if (this.ctx) this.nextTime = this.ctx.currentTime; }
}

function b64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

// ---- Client controller ----------------------------------------------------- //
class VisualActorClient {
  constructor({ canvas, badge, metrics, onProvider }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.badge = badge;
    this.metrics = metrics;
    this.onProvider = onProvider;
    this.audio = new AudioPlayer();
    this.firstFrameDisplayed = false;
    this.ws = null;
    this.connect();
    // idle render so the face is visible before first utterance
    this.lastBs = { jawOpen: 0.03 };
    this.renderLoop();
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.setBadge("ready", "var(--accent)");
    this.ws.onclose = () => { this.setBadge("disconnected", "#ff6b6b"); setTimeout(() => this.connect(), 1500); };
    this.ws.onerror = () => this.setBadge("error", "#ff6b6b");
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
  }

  setBadge(text, color) {
    if (this.badge) { this.badge.textContent = text; this.badge.style.color = color; }
  }

  onMessage(msg) {
    switch (msg.type) {
      case "frame":
        this.lastBs = msg.blendshapes;
        if (!this.firstFrameDisplayed) {
          this.firstFrameDisplayed = true;
          this.send({ type: "telemetry", event: "first_frame_displayed", t_ms: performance.now() });
        }
        break;
      case "audio":
        this.audio.play(b64ToInt16(msg.pcm), msg.sample_rate);
        break;
      case "provider":
        this.setBadge("voice: " + msg.name, "var(--accent)");
        if (this.onProvider) this.onProvider(msg.name);
        break;
      case "report":
        this.renderReport(msg);
        break;
      case "error":
        if (this.metrics) this.metrics.textContent = "Error: " + msg.message;
        break;
    }
  }

  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  say(text) {
    this.firstFrameDisplayed = false;
    this.audio.reset();
    this.send({ type: "say", text });
  }

  renderReport(msg) {
    if (!this.metrics) return;
    const g = msg.grade;
    const rows = Object.entries(g).map(([k, v]) => {
      const val = v.value == null ? "n/a" : v.value.toFixed(2);
      const cls = v.pass === false ? "fail" : "pass";
      return `<span class="${cls}">${k.padEnd(34)} ${String(val).padStart(8)} / ${v.target}  ${v.pass === false ? "FAIL" : "PASS"}</span>`;
    });
    const verdict = msg.passed ? `<span class="pass">VERDICT: PASS</span>` : `<span class="fail">VERDICT: FAIL</span>`;
    this.metrics.innerHTML = `provider: ${msg.provider}\n` + rows.join("\n") + "\n" + verdict;
  }

  renderLoop() {
    drawAvatar(this.ctx, this.lastBs || {}, this.canvas.width, this.canvas.height);
    requestAnimationFrame(() => this.renderLoop());
  }
}

// ---- Bootstrap ------------------------------------------------------------- //
window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("avatar");
  const client = new VisualActorClient({
    canvas,
    badge: document.getElementById("badge"),
    metrics: document.getElementById("metrics"),
  });
  const input = document.getElementById("text");
  const btn = document.getElementById("say");
  const fire = () => { if (input.value.trim()) client.say(input.value.trim()); };
  btn.addEventListener("click", fire);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") fire(); });
});
