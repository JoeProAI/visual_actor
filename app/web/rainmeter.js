"use strict";

const Avatar = window.VisualActorAvatar;
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
    this.gazeFromX = 0;
    this.gazeFromY = 0;
    this.gazeTargetX = 0;
    this.gazeTargetY = 0;
    this.gazeCurrentX = 0;
    this.gazeCurrentY = 0;
    this.gazeMoveDuration = 160;
    this.gazeHoldDuration = 280;
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
    this.gazeState = "hold";
  }

  updateBlink(now) {
    if (!this.blinking && now >= this.nextBlinkAt) {
      this.blinking = true;
      this.blinkStartAt = now;
    }

    if (!this.blinking) return 0;

    const closeMs = 62;
    const holdMs = 28;
    const openMs = 110;
    const elapsed = now - this.blinkStartAt;
    const total = closeMs + holdMs + openMs;

    if (elapsed <= closeMs) return smoothStep01(elapsed / closeMs);
    if (elapsed <= closeMs + holdMs) return 1;
    if (elapsed <= total) return 1 - smoothStep01((elapsed - closeMs - holdMs) / openMs);

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
      if (now >= this.gazeEndAt) this.gazeState = "holdTarget";
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

    out.breath = breath;
    out.headYaw = driftYaw;
    out.headPitch = driftPitch + breath * 0.45;
    out.headRoll = driftRoll;
    out.eyeBlinkLeft = blink;
    out.eyeBlinkRight = blink;
    out.eyeWideLeft = this.basePose.eyeWideLeft + 0.02 * Math.sin(t * 0.9 + this.phaseB);
    out.eyeWideRight = this.basePose.eyeWideRight + 0.02 * Math.sin(t * 0.87 + this.phaseC);

    const gazeX = this.gazeCurrentX;
    const gazeY = this.gazeCurrentY;
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

class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.nextTime = 0;
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
  }
}

class RainmeterClient {
  constructor() {
    this.serverPose = Avatar.createIdlePose();
    this.idleBasePose = Avatar.createIdlePose();
    this.idlePose = Avatar.createIdlePose();
    this.transitionPose = Avatar.createIdlePose();
    this.renderPose = Avatar.createIdlePose();
    this.idleAnimator = new IdleAnimator(this.idleBasePose);
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = 0;
    this.idleTransitionAt = 0;
    this.idleTransitionMs = 420;
    this.speakingUntil = 0;
    this.audio = new AudioPlayer();

    reconnectButton.addEventListener("click", () => this.connect());
    window.addEventListener("resize", () => resizeCanvasToDisplaySize(canvas));
    this.connect();
    requestAnimationFrame((t) => this.renderLoop(t));
  }

  beginIdleTransition(now) {
    Avatar.copyPose(this.transitionPose, this.renderPose);
    this.idleTransitionAt = now;
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
      if (msg.type === "frame") {
        Avatar.copyPose(this.serverPose, msg.blendshapes);
        this.speakingUntil = performance.now() + 260;
        this.idleTransitionAt = 0;
      } else if (msg.type === "audio") {
        this.audio.play(decodePcmBase64(msg.pcm), msg.sample_rate);
      }
    };
  }

  renderLoop() {
    resizeCanvasToDisplaySize(canvas);
    const now = performance.now();
    const idlePose = this.idleAnimator.sample(now, this.idlePose);
    if (now < this.speakingUntil) {
      Avatar.copyPose(this.renderPose, this.serverPose);
    } else {
      if (!this.idleTransitionAt) {
        this.beginIdleTransition(now);
      }
      const t = Math.min(1, (now - this.idleTransitionAt) / this.idleTransitionMs);
      mixPose(this.renderPose, this.transitionPose, idlePose, smoothStep01(t));
      if (t >= 1) this.idleTransitionAt = 0;
    }
    Avatar.drawAvatar(ctx, this.renderPose, canvas.width, canvas.height, { background: false });
    requestAnimationFrame((t) => this.renderLoop(t));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new RainmeterClient();
});
