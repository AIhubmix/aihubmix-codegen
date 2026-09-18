/**
 * Realtime 转录 TypeScript renderer：node + ws（浏览器不能直连网关 wss，示例面向服务端）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { RT_CHUNK_MS, RT_SAMPLE_RATE } from '../../config/realtime.js';
import { jsLiteral } from '../../emit/literal.js';
import { sessionUsesVad, type RealtimeCtx } from '../../wire/realtime.js';

export function realtimeTs(ctx: RealtimeCtx): string {
  const sessionStr = jsLiteral(ctx.session, '    ');
  const vad = sessionUsesVad(ctx);
  const configNote = vad
    ? 'first frame; server VAD auto-segments speech as you stream'
    : 'first frame; turn_detection is null, so you finalize segments with commit';
  const commitNote = vad
    ? 'Server VAD segments on pauses; flush any trailing audio at end of stream'
    : 'No VAD: commit to finalize the segment';
  // VAD 流随停顿吐多段 completed —— flushed 标记发完整段 + flush 后收尾那一段再关；
  // 手动模式只有一段，第一条 completed 即关。
  const completedBranch = vad
    ? `  } else if (type.endsWith("transcription.completed")) {
    console.log("\\n[segment]", evt.transcript);
    if (flushed) ws.close(); // last segment after the final flush → done
  } else if (type === "error") {`
    : `  } else if (type.endsWith("transcription.completed")) {
    console.log("\\n[done]", evt.transcript);
    ws.close();
  } else if (type === "error") {`;
  const flushedDecl = vad ? '\nlet flushed = false; // set once the whole stream is sent + flushed\n' : '';
  const flushedSet = vad ? '\n  flushed = true;' : '';
  return `// npm install ws
import WebSocket from "ws";
import { readFile } from "node:fs/promises";

// Realtime transcription is a WebSocket session: model must be in the handshake URL.
const url = "${ctx.url}";
const ws = new WebSocket(url, {
  headers: { Authorization: "Bearer " + ${ENV_KEY_EXPR.javascript} },
});
${flushedDecl}
ws.on("open", async () => {
  // 1) Configure the transcription session (${configNote})
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
  // ${commitNote}
  ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));${flushedSet}
});

ws.on("message", (data) => {
  const evt = JSON.parse(String(data));
  const type = evt.type ?? "";
  if (type.endsWith("transcription.delta")) {
    process.stdout.write(evt.delta ?? "");
${completedBranch}
    console.error("\\n[error]", evt.error);
    ws.close();
  }
});`;
}
