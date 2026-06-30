// Visual Actor — Rainmeter WebView2 client.
// Transparent-background avatar renderer + audio playback, with graceful
// offline degradation and a reconnect button. Mirrors app.js but clears the
// canvas to transparent so the desktop shows through the WebView2 host.

"use strict";

function drawAvatar(ctx, bs, W, H) {
  ctx.clearRect(0, 0, W, H); // transparent background
  const dx = (bs.headYaw / 30) * W * 0.04;
  const dy = (bs.headPitch / 30) * H * 0.03 - (bs.breath || 0) * H * 0.01;

  const cx = 0.5 * W + dx, cy = 0.46 * H + dy;
  ctx.fillStyle = "#e8c6ae";
  ell(ctx, cx, cy, 0.30 * W, 0.34 * H);

  eye(ctx, 0.38 * W + dx, 0.40 * H + dy, bs.eyeBlinkLeft, bs.eyeWideLeft,
      (bs.eyeLookOutLeft || 0) - (bs.eyeLookInLeft || 0),
      (bs.eyeLookUpLeft || 0) - (bs.eyeLookDownLeft || 0), W, H);
  eye(ctx, 0.62 * W + dx, 0.40 * H + dy, bs.eyeBlinkRight, bs.eyeWideRight,
      (bs.eyeLookInRight || 0) - (bs.eyeLookOutRight || 0),
      (bs.eyeLookUpRight || 0) - (bs.eyeLookDownRight || 0), W, H);

  const smile = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) * 0.5;
  const ws = 1 + 0.4 * smile - 0.5 * (bs.mouthPucker || 0) - 0.3 * (bs.mouthFunnel || 0);
  const mrx = Math.max(2, 0.10 * W * ws), mry = Math.max(1, H * (0.012 + 0.09 * (bs.jawOpen || 0)));
  const mx = 0.5 * W + dx, my = 0.66 * H + dy - smile * H * 0.01;
  ctx.fillStyle = "#78323c";
  ell(ctx, mx, my, mrx, mry);
  if ((bs.jawOpen || 0) > 0.1) { ctx.fillStyle = "#3c141e"; ell(ctx, mx, my, mrx * 0.8, mry * 0.7); }
}
function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, 6.2832); c.fill(); }
function eye(c, x, y, blink, wide, lx, ly, W, H) {
  const open = (1 - (blink || 0)) * (1 + 0.4 * (wide || 0));
  const ry = Math.max(0.5, H * 0.022 * open), rx = W * 0.05;
  c.fillStyle = "#fafafc"; ell(c, x, y, rx, ry);
  if (open > 0.15) { c.fillStyle = "#28283c"; ell(c, x + lx * rx * 0.5, y - ly * ry * 0.6, rx * 0.4, ry * 0.6); }
}

function b64ToInt16(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

class Audio {
  constructor() { this.ctx = null; this.next = 0; }
  play(i16, sr) {
    if (!this.ctx) { this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sr }); this.next = this.ctx.currentTime; }
    if (!i16.length) return;
    const f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    const b = this.ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0);
    const s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination);
    const t = Math.max(this.ctx.currentTime, this.next); s.start(t); this.next = t + b.duration;
  }
}

let ws = null, lastBs = { jawOpen: 0.03 }, audio = new Audio();
const canvas = document.getElementById("avatar");
const ctx = canvas.getContext("2d");
const offline = document.getElementById("offline");

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => offline.classList.remove("show");
  ws.onclose = () => offline.classList.add("show");
  ws.onerror = () => offline.classList.add("show");
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "frame") lastBs = m.blendshapes;
    else if (m.type === "audio") audio.play(b64ToInt16(m.pcm), m.sample_rate);
  };
}
function say(t) { if (ws && ws.readyState === 1 && t.trim()) ws.send(JSON.stringify({ type: "say", text: t.trim() })); }

function loop() { drawAvatar(ctx, lastBs || {}, canvas.width, canvas.height); requestAnimationFrame(loop); }

window.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("text");
  document.getElementById("say").addEventListener("click", () => say(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") say(input.value); });
  document.getElementById("reconnect").addEventListener("click", connect);
  connect();
  loop();
});
