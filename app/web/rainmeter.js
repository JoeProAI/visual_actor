"use strict";

const ArcReactor = window.VisualActorArcReactor;
const canvas = document.getElementById("avatar");
const ctx = canvas.getContext("2d");
const offlineCard = document.getElementById("offline-card");
const reconnectButton = document.getElementById("reconnect");

function decodePcmBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

function resizeCanvasToDisplaySize(canvasEl) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(window.innerWidth * dpr));
  const height = Math.max(1, Math.round(window.innerHeight * dpr));
  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
    return true;
  }
  return false;
}

class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.nextTime = 0;
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
}

class RainmeterClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = 0;
    this.reactorState = ArcReactor.createState();
    this.audio = new AudioPlayer();

    reconnectButton.addEventListener("click", () => this.connect());
    window.addEventListener("resize", () => resizeCanvasToDisplaySize(canvas));
    this.connect();
    requestAnimationFrame((t) => this.renderLoop(t));
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
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);

    this.ws.onopen = () => {
      this.connected = true;
      offlineCard.classList.remove("show");
    };

    this.ws.onclose = () => {
      this.connected = false;
      offlineCard.classList.add("show");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
      offlineCard.classList.add("show");
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "audio") {
        this.audio.play(decodePcmBase64(msg.pcm), msg.sample_rate);
      }
    };
  }

  renderLoop(timestamp) {
    resizeCanvasToDisplaySize(canvas);
    const audioData = this.audio.sample();
    ArcReactor.draw(ctx, canvas.width, canvas.height, audioData, performance.now(), this.reactorState);
    requestAnimationFrame((t) => this.renderLoop(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new RainmeterClient();
});
