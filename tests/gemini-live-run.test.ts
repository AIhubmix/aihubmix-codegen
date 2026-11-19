/**
 * Gemini Live TypeScript 精品格 —— 真跑生成的示例（Round 1 审查回归）。
 *
 * 把产物落到临时目录，用一个假的 `ws` 模块顶替真 WebSocket：
 * - 回复分片跨多条 message 时，写入文件的字节顺序必须与到达顺序一致（曾经 ABC → ACB）。
 * - 开摄像头时，JPEG 帧与音频并发发送，而不是排在 audioStreamEnd 之后。
 * - 会话关闭后发送循环停止，不再往已关闭的连接上发帧。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateGeminiLiveCode } from '../src/generate.js';

/**
 * 假 ws：收到 setup 回 setupComplete；收到 audioStreamEnd 后连发两条回复
 * （第一条含分片 A、B，第二条含 C），再发 turnComplete。
 * 所有发出的帧按顺序记进 sent.json，连接关闭后再 send 记为 AFTER_CLOSE。
 */
const FAKE_WS = `
const { EventEmitter } = require("node:events");
const { writeFileSync } = require("node:fs");
const b64 = (s) => Buffer.from(s).toString("base64");
const part = (s) => ({ inlineData: { mimeType: "audio/pcm", data: b64(s) } });
class WebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    this.replied = false;
    setTimeout(() => { this.readyState = 1; this.emit("open"); }, 5);
  }
  push(obj) { this.emit("message", Buffer.from(JSON.stringify(obj))); }
  send(raw) {
    if (this.readyState !== 1) { this.sent.push("AFTER_CLOSE"); this.flush(); return; }
    const m = JSON.parse(raw);
    const ri = m.realtimeInput || {};
    this.sent.push(m.setup ? "setup" : ri.audio ? "audio" : ri.video ? "video" : ri.audioStreamEnd ? "audioStreamEnd" : "other");
    this.flush();
    if (m.setup) return setTimeout(() => this.push({ setupComplete: {} }), 5);
    if (ri.audioStreamEnd && !this.replied) {
      this.replied = true;
      setTimeout(() => {
        this.push({ serverContent: { modelTurn: { parts: [part("A"), part("B")] } } });
        this.push({ serverContent: { modelTurn: { parts: [part("C")] } } });
        this.push({ serverContent: { turnComplete: true } });
      }, 5);
    }
  }
  flush() { writeFileSync("sent.json", JSON.stringify(this.sent)); }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit("close", code, Buffer.from("")), 0);
  }
}
WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSING = 2; WebSocket.CLOSED = 3;
module.exports = WebSocket;
module.exports.default = WebSocket;
`;

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function runTs(over: { video?: boolean; output?: 'audio' | 'avatar' } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'gl-run-'));
  mkdirSync(join(dir, 'node_modules', 'ws'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'ws', 'package.json'), '{"name":"ws","main":"index.js"}');
  writeFileSync(join(dir, 'node_modules', 'ws', 'index.js'), FAKE_WS);
  // 3 个 100ms 音频块，足够让并发的视频帧插到 audioStreamEnd 之前
  writeFileSync(join(dir, 'audio_pcm16_16k.raw'), Buffer.alloc(16000 * 2 * 0.3));
  writeFileSync(join(dir, 'frame_001.jpg'), Buffer.from([0xff, 0xd8, 1]));
  writeFileSync(join(dir, 'frame_002.jpg'), Buffer.from([0xff, 0xd8, 2]));
  const code = generateGeminiLiveCode({
    baseUrl: 'https://api.inferera.com',
    modelId: 'gemini-3.8-live',
    lang: 'javascript',
    ...over,
  });
  writeFileSync(join(dir, 'main.mjs'), code);
  execFileSync(process.execPath, ['main.mjs'], { cwd: dir, env: { ...process.env, AIHUBMIX_API_KEY: 'test' }, timeout: 15000 });
  // 发送循环可能还在 sleep，等它们醒来再读，才能抓到“关闭后仍在发”
  execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1200)']);
  return {
    sent: JSON.parse(readFileSync(join(dir, 'sent.json'), 'utf8')) as string[],
    reply: (name: string) => readFileSync(join(dir, name), 'utf8'),
  };
}

describe('Gemini Live TypeScript 示例真跑（假 ws）', () => {
  it('跨消息的回复分片按到达顺序写入文件', () => {
    const { reply } = runTs();
    expect(reply('reply_pcm16_24k.raw')).toBe('ABC');
  });

  it('数字人 fMP4 同样按序写入', () => {
    const { reply } = runTs({ output: 'avatar' });
    expect(reply('avatar_reply.mp4')).toBe('ABC');
  });

  it('开摄像头：视频帧与音频并发，首帧早于 audioStreamEnd；关闭后不再发帧', () => {
    const { sent } = runTs({ video: true });
    expect(sent[0]).toBe('setup');
    const firstVideo = sent.indexOf('video');
    expect(firstVideo, `sent=${sent.join(',')}`).toBeGreaterThan(0);
    expect(firstVideo).toBeLessThan(sent.indexOf('audioStreamEnd'));
    expect(sent).not.toContain('AFTER_CLOSE');
  });
});
