/**
 * Realtime 转录 TypeScript renderer：node + ws（浏览器不能直连网关 wss，示例面向服务端）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { RT_CHUNK_MS, RT_SAMPLE_RATE } from '../../config/realtime.js';
import { jsLiteral } from '../../emit/literal.js';
import type { RealtimeCtx } from '../../wire/realtime.js';

export function realtimeTs(ctx: RealtimeCtx): string {
  const sessionStr = jsLiteral(ctx.session, '    ');
  return `// npm install ws
import WebSocket from "ws";
import { readFile } from "node:fs/promises";

// Realtime transcription is a WebSocket session: model must be in the handshake URL.
const url = "${ctx.url}";
const ws = new WebSocket(url, {
  headers: { Authorization: "Bearer " + ${ENV_KEY_EXPR.javascript} },
});

ws.on("open", async () => {
  // 1) Configure the transcription session (first frame; turn_detection must stay null)
  ws.send(JSON.stringify(${sessionStr}));

  // 2) Stream raw PCM16 / ${RT_SAMPLE_RATE / 1000}kHz / mono audio in ~${RT_CHUNK_MS}ms chunks
  const pcm = await readFile("audio_pcm16_24k.raw");
  const chunk = (${RT_SAMPLE_RATE} * 2 * ${RT_CHUNK_MS}) / 1000; // ${RT_CHUNK_MS}ms of 16-bit mono samples
  for (let i = 0; i < pcm.length; i += chunk) {
    ws.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcm.subarray(i, i + chunk).toString("base64"),
    }));
    await new Promise((r) => setTimeout(r, ${RT_CHUNK_MS})); // simulate realtime pacing
  }
  // No VAD in transcription sessions: commit manually to finalize the segment
  ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
});

ws.on("message", (data) => {
  const evt = JSON.parse(String(data));
  const type = evt.type ?? "";
  if (type.endsWith("transcription.delta")) {
    process.stdout.write(evt.delta ?? "");
  } else if (type.endsWith("transcription.completed")) {
    console.log("\\n[done]", evt.transcript);
    ws.close();
  } else if (type === "error") {
    console.error("\\n[error]", evt.error);
    ws.close();
  }
});`;
}
