/**
 * Realtime 对话（conversation / speech-to-speech）渲染器。
 *
 * 与转录版的三处根本区别：
 * - 握手 URL 不带 intent（对话 kind 由网关按模型名推导）。
 * - session.update 拼 output.voice + server_vad，**绝不拼 input.transcription**（带上=1008）。
 * - 接收循环收的是**音频回放**（response.audio.delta = base64 PCM16 → 落文件/播放）+ 助手文字
 *   （response.audio_transcript.delta），不是转录的收字打印；且**不发 commit / response.create**
 *   ——服务端 VAD 检测到你停顿即自动起回复。
 *
 * 事件名匹配用 endswith 取尾段（"audio.delta" / "audio_transcript.delta"）：peer 实测 gpt-realtime-2.1
 * 回的是 response.audio.delta / response.audio_transcript.delta，取尾段可同时兼容 GA 可能的
 * output_audio 改名，不因上游改名静默失效。
 */
import { API_KEY_PLACEHOLDER, ENV_KEY_EXPR } from '../../config/placeholders.js';
import { RT_CHUNK_MS, RT_SAMPLE_RATE } from '../../config/realtime.js';
import { jsLiteral, pyLiteral } from '../../emit/literal.js';
import type { RealtimeCtx } from '../../wire/realtime.js';

const KB = RT_SAMPLE_RATE / 1000; // 24 kHz → 24

export function realtimeConvPy(ctx: RealtimeCtx): string {
  const sessionStr = pyLiteral(ctx.session, '        ');
  return `# pip install websockets
import asyncio
import base64
import json
import os
import websockets

# Realtime conversation is a WebSocket session: model must be in the handshake URL.
URL = "${ctx.url}"

async def main():
    # websockets >= 13 uses additional_headers; older versions use extra_headers
    async with websockets.connect(
        URL, additional_headers={"Authorization": "Bearer " + ${ENV_KEY_EXPR.python}}
    ) as ws:
        # 1) Configure the speech-to-speech session (voice + server VAD; no input transcription)
        await ws.send(json.dumps(${sessionStr}))

        # 2) Stream your mic as raw PCM16 / ${KB}kHz / mono in ~${RT_CHUNK_MS}ms chunks. Server VAD
        #    detects when you stop talking and starts the reply automatically —
        #    no commit / response.create needed.
        async def send_audio():
            with open("audio_pcm16_24k.raw", "rb") as f:
                pcm = f.read()
            chunk = ${RT_SAMPLE_RATE} * 2 * ${RT_CHUNK_MS} // 1000  # ${RT_CHUNK_MS}ms of 16-bit mono samples
            for i in range(0, len(pcm), chunk):
                await ws.send(json.dumps({
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(pcm[i:i + chunk]).decode(),
                }))
                await asyncio.sleep(${RT_CHUNK_MS / 1000})  # simulate realtime pacing

        asyncio.create_task(send_audio())

        # 3) Receive the reply: audio streams as base64 PCM16 (${KB}kHz) — write it to a file you
        #    can play; the transcript of what the model says arrives as text deltas.
        reply = open("assistant_reply_pcm16_24k.raw", "wb")
        async for msg in ws:
            evt = json.loads(msg)
            etype = evt.get("type", "")
            if etype == "input_audio_buffer.speech_started":
                # Barge-in: you started talking — stop/flush local playback here
                print("\\n[listening…]")
            elif etype.endswith("audio_transcript.delta"):
                print(evt.get("delta", ""), end="", flush=True)
            elif etype.endswith("audio.delta"):
                reply.write(base64.b64decode(evt.get("delta", "")))
            elif etype.endswith("response.done"):
                print("\\n[reply complete]")
            elif etype == "error":
                print("\\n[error]", evt.get("error"))
                break
        reply.close()

asyncio.run(main())`;
}

export function realtimeConvTs(ctx: RealtimeCtx): string {
  const sessionStr = jsLiteral(ctx.session, '    ');
  return `// npm install ws
import WebSocket from "ws";
import { readFile, open } from "node:fs/promises";

// Realtime conversation is a WebSocket session: model must be in the handshake URL.
const url = "${ctx.url}";
const ws = new WebSocket(url, {
  headers: { Authorization: "Bearer " + ${ENV_KEY_EXPR.javascript} },
});

// Assistant reply audio (base64 PCM16 / ${KB}kHz) is appended here — play it back to hear the model.
const reply = await open("assistant_reply_pcm16_24k.raw", "w");

ws.on("open", async () => {
  // 1) Configure the speech-to-speech session (voice + server VAD; no input transcription)
  ws.send(JSON.stringify(${sessionStr}));

  // 2) Stream your mic as raw PCM16 / ${KB}kHz / mono in ~${RT_CHUNK_MS}ms chunks. Server VAD
  //    detects when you stop talking and starts the reply automatically — no commit needed.
  const pcm = await readFile("audio_pcm16_24k.raw");
  const chunk = (${RT_SAMPLE_RATE} * 2 * ${RT_CHUNK_MS}) / 1000; // ${RT_CHUNK_MS}ms of 16-bit mono samples
  for (let i = 0; i < pcm.length; i += chunk) {
    ws.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: pcm.subarray(i, i + chunk).toString("base64"),
    }));
    await new Promise((r) => setTimeout(r, ${RT_CHUNK_MS})); // simulate realtime pacing
  }
});

ws.on("message", async (data) => {
  const evt = JSON.parse(String(data));
  const type = evt.type ?? "";
  if (type === "input_audio_buffer.speech_started") {
    // Barge-in: you started talking — stop/flush local playback here
    process.stdout.write("\\n[listening…]\\n");
  } else if (type.endsWith("audio_transcript.delta")) {
    process.stdout.write(evt.delta ?? "");
  } else if (type.endsWith("audio.delta")) {
    await reply.write(Buffer.from(evt.delta ?? "", "base64"));
  } else if (type.endsWith("response.done")) {
    process.stdout.write("\\n[reply complete]\\n");
  } else if (type === "error") {
    console.error("\\n[error]", evt.error);
    ws.close();
  }
});`;
}

export function realtimeConvCurl(ctx: RealtimeCtx): string {
  const sessionLine = JSON.stringify(ctx.session);
  return `# Realtime conversation is a bidirectional WebSocket session — plain curl
# cannot stream it. Quick connectivity + auth check with wscat (npm i -g wscat):
wscat -c "${ctx.url}" \\
  -H "Authorization: Bearer ${ENV_KEY_EXPR.curl}"

# After it connects, paste this session.update frame (voice + server VAD, no input transcription):
# ${sessionLine}
#
# Then stream your mic as audio frames (base64 PCM16 / ${KB}kHz / mono):
#   {"type":"input_audio_buffer.append","audio":"<BASE64_PCM16_CHUNK>"}
# Server VAD starts the reply automatically when you pause — no commit / response.create needed.
# The reply arrives as response.audio.delta (base64 PCM16 audio to play) and
# response.audio_transcript.delta (the model's words as text); response.done ends a turn.
# For a runnable end-to-end sample, see the Python or TypeScript tab.`;
}

const LANG_NAME = { go: 'Go', java: 'Java', csharp: 'C#', ruby: 'Ruby' } as const;

export function realtimeConvFallback(lang: keyof typeof LANG_NAME): (ctx: RealtimeCtx) => string {
  const prefix = lang === 'ruby' ? '#' : '//';
  const name = LANG_NAME[lang];
  return (ctx) =>
    `${prefix} Realtime conversation runs over a WebSocket session (not HTTP request/response).
${prefix} A polished ${name} sample is on the way — any WebSocket client works today:
${prefix}   URL:    ${ctx.url}
${prefix}   Header: Authorization: Bearer <${API_KEY_PLACEHOLDER} from your environment>
${prefix}   1) send a session.update frame (copy it from the Python or TypeScript tab)
${prefix}   2) stream your mic {"type":"input_audio_buffer.append","audio":"<base64 PCM16 / ${KB}kHz / mono>"}
${prefix}   3) server VAD starts the reply on a pause — no commit / response.create needed
${prefix}   4) play response.audio.delta (base64 PCM16 audio) and read response.audio_transcript.delta (text)`;
}
