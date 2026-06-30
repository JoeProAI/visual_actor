"use strict";

const Avatar = window.VisualActorAvatar;
const canvas = document.getElementById("avatar");
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
    this.nextTime = 0;
    this.started = false;
    this.onStart = onStart;
  }

  ensure(sampleRate) {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
      this.nextTime = this.ctx.currentTime;
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
    source.connect(this.ctx.destination);
    const start = Math.max(this.ctx.currentTime, this.nextTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
    if (!this.started) {
      this.started = true;
      if (this.onStart) this.onStart();
    }
  }

  reset() {
    this.started = false;
    if (this.ctx) this.nextTime = this.ctx.currentTime;
  }
}

class VisualActorClient {
  constructor() {
    this.pose = Avatar.createIdlePose();
    this.ws = null;
    this.connected = false;
    this.busy = false;
    this.sessionActive = false;
    this.firstFrameTelemetrySent = false;
    this.audioStartedTelemetrySent = false;
    this.provider = "—";
    this.reconnectTimer = 0;
    this.fps = 0;
    this.lastTick = 0;
    this.audio = new AudioPlayer(() => this.sendTelemetry("audio_playback_start"));
    this.audioFrameCount = 0;

    this.setStatus("connecting", "Connecting…", "Opening live socket…");
    renderReport(null);
    this.updateProviderLabels();
    this.updateSpeakButton();

    speakButton.addEventListener("click", () => this.say());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.say();
    });

    window.addEventListener("resize", () => resizeCanvasToDisplaySize(canvas));
    this.connect();
    requestAnimationFrame((t) => this.renderLoop(t));
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
      this.finishSession();
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
          Avatar.copyPose(this.pose, msg.blendshapes);
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
          this.finishSession();
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

  finishSession() {
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
    this.firstFrameTelemetrySent = false;
    this.audioStartedTelemetrySent = false;
    this.audio.reset();
    this.updateSpeakButton();
    this.send({ type: "say", text });
  }

  renderLoop(timestamp) {
    resizeCanvasToDisplaySize(canvas);
    Avatar.drawAvatar(ctx, this.pose, canvas.width, canvas.height, { background: true });

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
