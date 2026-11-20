/**
 * Gemini Live（原生 BidiGenerateContent）渲染器。
 *
 * 与 OpenAI realtime 对话渲染器的区别（线协议不同，不共用任何拼接）：
 * - 首帧是 {setup:{…}}，等 setupComplete 再推流（网关在 setupComplete 前拒收输入帧）。
 * - 音频帧 realtimeInput.audio，PCM16 / 16kHz（不是 24kHz）；服务端 VAD 自动分段，无 commit。
 * - 下行 serverContent：modelTurn.parts[].inlineData（音频 PCM 或数字人 fMP4）、
 *   inputTranscription / outputTranscription（转写）、interrupted（被打断）、turnComplete（一轮结束）。
 *
 * 精品格 python / typescript，其余语言为可行动的降级注释块（同 realtime 先例）。
 */
import { API_KEY_PLACEHOLDER, ENV_KEY_EXPR } from '../config/placeholders.js';
import {
  GL_CHUNK_MS,
  GL_INPUT_RATE,
  GL_OUTPUT_RATE,
  GL_VIDEO_FPS,
} from '../config/gemini-live.js';
import { jsLiteral, pyLiteral } from '../emit/literal.js';
import type { GeminiLiveCtx } from '../wire/gemini-live.js';

const IN_KHZ = GL_INPUT_RATE / 1000;
const OUT_KHZ = GL_OUTPUT_RATE / 1000;

function replyNote(ctx: GeminiLiveCtx): string {
  return ctx.output === 'avatar'
    ? 'the avatar reply streams as one fragmented MP4 (H.264 + AAC) — append every chunk to a single .mp4'
    : `the spoken reply streams as base64 PCM16 / ${OUT_KHZ}kHz audio; the transcript arrives as text`;
}

export function geminiLivePy(ctx: GeminiLiveCtx): string {
  const setupStr = pyLiteral(ctx.setup, '        ');
  const avatar = ctx.output === 'avatar';
  const outFile = avatar ? 'avatar_reply.mp4' : `reply_pcm16_${OUT_KHZ}k.raw`;
  const videoRead = ctx.video
    ? `
    # Optional camera frames: JPEG, 768x768 or smaller
    frames = []
    for path in ["frame_001.jpg", "frame_002.jpg"]:
        with open(path, "rb") as f:
            frames.append(f.read())`
    : '';
  const videoTask = ctx.video
    ? `
        # Camera frames go out alongside the audio at ~${GL_VIDEO_FPS} FPS, not after it
        async def send_video():
            for jpeg in frames:
                await ws.send(json.dumps({"realtimeInput": {"video": {
                    "mimeType": "image/jpeg", "data": base64.b64encode(jpeg).decode()}}}))
                await asyncio.sleep(${1 / GL_VIDEO_FPS})
`
    : '';
  const senders = ctx.video
    ? '[asyncio.create_task(send_audio()), asyncio.create_task(send_video())]'
    : '[asyncio.create_task(send_audio())]';
  return `# pip install websockets
import asyncio
import base64
import json
import os
import websockets

# Gemini Live is a WebSocket session: the model must be in the handshake URL.
URL = "${ctx.url}"

async def main():
    # Read inputs before connecting, so a missing file fails fast instead of hanging the session
    with open("audio_pcm16_${IN_KHZ}k.raw", "rb") as f:
        pcm = f.read()${videoRead}

    # websockets >= 13 uses additional_headers; older versions use extra_headers
    async with websockets.connect(
        URL, additional_headers={"Authorization": "Bearer " + ${ENV_KEY_EXPR.python}}, max_size=None
    ) as ws:
        # 1) Configure the session, then wait for setupComplete before streaming
        await ws.send(json.dumps(${setupStr}))
        json.loads(await ws.recv())  # {"setupComplete": {...}}

        # 2) Stream your mic as raw PCM16 / ${IN_KHZ}kHz / mono in ~${GL_CHUNK_MS}ms chunks.
        #    Server VAD detects when you stop talking and replies — no commit needed.
        async def send_audio():
            chunk = ${GL_INPUT_RATE} * 2 * ${GL_CHUNK_MS} // 1000  # ${GL_CHUNK_MS}ms of 16-bit mono samples
            for i in range(0, len(pcm), chunk):
                await ws.send(json.dumps({"realtimeInput": {"audio": {
                    "mimeType": "audio/pcm;rate=${GL_INPUT_RATE}",
                    "data": base64.b64encode(pcm[i:i + chunk]).decode(),
                }}}))
                await asyncio.sleep(${GL_CHUNK_MS / 1000})  # simulate realtime pacing
            await ws.send(json.dumps({"realtimeInput": {"audioStreamEnd": True}}))
${videoTask}
        senders = ${senders}

        # 3) Receive: ${replyNote(ctx)}.
        try:
            with open("${outFile}", "wb") as reply:
                async for msg in ws:
                    evt = json.loads(msg)
                    sc = evt.get("serverContent", {})
                    for part in sc.get("modelTurn", {}).get("parts", []):
                        data = part.get("inlineData", {}).get("data")
                        if data:
                            reply.write(base64.b64decode(data))
                    if "inputTranscription" in sc:
                        print("[you]", sc["inputTranscription"].get("text", ""))
                    if "outputTranscription" in sc:
                        print(sc["outputTranscription"].get("text", ""), end="", flush=True)
                    if sc.get("interrupted"):
                        print("\\n[interrupted]")  # you talked over the model — flush local playback here
                    if sc.get("turnComplete"):
                        print("\\n[turn complete]")
                        break
        finally:
            for task in senders:
                task.cancel()  # stop streaming once the turn (or the session) ends

asyncio.run(main())`;
}

export function geminiLiveTs(ctx: GeminiLiveCtx): string {
  const setupStr = jsLiteral(ctx.setup, '');
  const avatar = ctx.output === 'avatar';
  const outFile = avatar ? 'avatar_reply.mp4' : `reply_pcm16_${OUT_KHZ}k.raw`;
  const videoRead = ctx.video
    ? `
// Optional camera frames: JPEG, 768x768 or smaller
const frames = await Promise.all(["frame_001.jpg", "frame_002.jpg"].map((p) => readFile(p)));`
    : '';
  const videoSender = ctx.video
    ? `

async function sendVideo() {
  // Camera frames go out alongside the audio at ~${GL_VIDEO_FPS} FPS, not after it
  for (const jpeg of frames) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ realtimeInput: { video: { mimeType: "image/jpeg", data: jpeg.toString("base64") } } }));
    await new Promise((r) => setTimeout(r, ${1000 / GL_VIDEO_FPS}));
  }
}`
    : '';
  const startSenders = ctx.video ? 'void sendAudio(); // audio and video stream concurrently\n      void sendVideo();' : 'void sendAudio();';
  return `// npm install ws
import WebSocket from "ws";
import { readFile, open } from "node:fs/promises";

// Gemini Live is a WebSocket session: the model must be in the handshake URL.
const url = "${ctx.url}";

// Read inputs before connecting, so a missing file fails fast instead of hanging the session
const pcm = await readFile("audio_pcm16_${IN_KHZ}k.raw");${videoRead}
const reply = await open("${outFile}", "w");

const ws = new WebSocket(url, {
  headers: { Authorization: "Bearer " + ${ENV_KEY_EXPR.javascript} },
});

// 1) Session config — sent first; stream only after the server answers setupComplete
const setup = ${setupStr};
ws.on("open", () => ws.send(JSON.stringify(setup)));

async function sendAudio() {
  // 2) Stream your mic as raw PCM16 / ${IN_KHZ}kHz / mono in ~${GL_CHUNK_MS}ms chunks.
  //    Server VAD detects when you stop talking and replies — no commit needed.
  const chunk = (${GL_INPUT_RATE} * 2 * ${GL_CHUNK_MS}) / 1000; // ${GL_CHUNK_MS}ms of 16-bit mono samples
  for (let i = 0; i < pcm.length; i += chunk) {
    if (ws.readyState !== WebSocket.OPEN) return; // session ended — stop streaming
    ws.send(JSON.stringify({ realtimeInput: { audio: {
      mimeType: "audio/pcm;rate=${GL_INPUT_RATE}",
      data: pcm.subarray(i, i + chunk).toString("base64"),
    } } }));
    await new Promise((r) => setTimeout(r, ${GL_CHUNK_MS})); // simulate realtime pacing
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
}${videoSender}

// 3) Receive: ${replyNote(ctx)}.
//    Messages are handled one at a time so reply chunks land in the file in arrival order.
let queue = Promise.resolve();
ws.on("message", (data) => {
  queue = queue.then(async () => {
    const evt = JSON.parse(String(data));
    if (evt.setupComplete) {
      ${startSenders}
      return;
    }
    const sc = evt.serverContent ?? {};
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) await reply.write(Buffer.from(part.inlineData.data, "base64"));
    }
    if (sc.inputTranscription) console.log("[you]", sc.inputTranscription.text ?? "");
    if (sc.outputTranscription) process.stdout.write(sc.outputTranscription.text ?? "");
    if (sc.interrupted) console.log("\\n[interrupted]"); // you talked over the model — flush playback
    if (sc.turnComplete) {
      console.log("\\n[turn complete]");
      ws.close(1000);
    }
  }).catch((err) => {
    console.error(err);
    ws.close();
  });
});
ws.on("close", (code, reason) => {
  if (code !== 1000) console.error("[closed]", code, String(reason));
  queue = queue.then(() => reply.close()); // close the file only after every queued write
});`;
}

export function geminiLiveCurl(ctx: GeminiLiveCtx): string {
  const setupLine = JSON.stringify(ctx.setup);
  return `# Gemini Live is a bidirectional WebSocket session — plain curl cannot stream it.
# Quick connectivity + auth check with wscat (npm i -g wscat):
wscat -c "${ctx.url}" \\
  -H "Authorization: Bearer ${ENV_KEY_EXPR.curl}"

# After it connects, paste this setup frame and wait for {"setupComplete": {...}}:
# ${setupLine}
#
# Then send input frames:
#   {"realtimeInput":{"text":"Hello!"}}
#   {"realtimeInput":{"audio":{"mimeType":"audio/pcm;rate=${GL_INPUT_RATE}","data":"<BASE64_PCM16_CHUNK>"}}}
# Replies arrive as serverContent.modelTurn.parts[].inlineData (${ctx.output === 'avatar' ? 'fragmented MP4 video' : `PCM16 / ${OUT_KHZ}kHz audio`}),
# serverContent.outputTranscription (the model's words) and serverContent.turnComplete.
# For a runnable end-to-end sample, see the Python or TypeScript tab.`;
}

const LANG_NAME = { go: 'Go', java: 'Java', csharp: 'C#', ruby: 'Ruby' } as const;

export function geminiLiveFallback(lang: keyof typeof LANG_NAME): (ctx: GeminiLiveCtx) => string {
  const prefix = lang === 'ruby' ? '#' : '//';
  const name = LANG_NAME[lang];
  return (ctx) =>
    `${prefix} Gemini Live runs over a WebSocket session (not HTTP request/response).
${prefix} A polished ${name} sample is on the way — any WebSocket client works today:
${prefix}   URL:    ${ctx.url}
${prefix}   Header: Authorization: Bearer <${API_KEY_PLACEHOLDER} from your environment>
${prefix}   1) send the setup frame (copy it from the Python or TypeScript tab), wait for setupComplete
${prefix}   2) stream {"realtimeInput":{"audio":{"mimeType":"audio/pcm;rate=${GL_INPUT_RATE}","data":"<base64 PCM16>"}}}
${prefix}   3) server VAD replies on a pause — no commit needed
${prefix}   4) read serverContent.modelTurn.parts[].inlineData and serverContent.outputTranscription`;
}
