/**
 * Realtime 转录 Python renderer：原生 websockets（依赖最少，官方 SDK 版见 docs）。
 * 三段式：session.update 首帧 → append/commit 推流 → 事件循环收 delta/completed。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { RT_CHUNK_MS, RT_SAMPLE_RATE } from '../../config/realtime.js';
import { pyLiteral } from '../../emit/literal.js';
import { sessionUsesVad, type RealtimeCtx } from '../../wire/realtime.js';

export function realtimePy(ctx: RealtimeCtx): string {
  const sessionStr = pyLiteral(ctx.session, '        ');
  const vad = sessionUsesVad(ctx);
  const configNote = vad
    ? 'first frame; server VAD auto-segments speech as you stream'
    : 'first frame; turn_detection is null, so you finalize segments with commit';
  const commitNote = vad
    ? 'Server VAD segments on pauses; flush any trailing audio at end of stream'
    : 'No VAD: commit to finalize the segment';
  // VAD 流会随停顿吐多段 completed —— 发完整段音频 + flush 后，用 flushed 标记收尾那一段再退出，
  // 避免在文件中途的第一段就 break（手动模式只有一段，第一条 completed 即收）。
  const recvLoop = vad
    ? `        # 3) Receive events: deltas stream live; each pause finalizes a segment (server VAD)
        async for msg in ws:
            evt = json.loads(msg)
            etype = evt.get("type", "")
            if etype.endswith("transcription.delta"):
                print(evt.get("delta", ""), end="", flush=True)
            elif etype.endswith("transcription.completed"):
                print("\\n[segment]", evt.get("transcript", ""))
                if flushed.is_set():  # last segment after the final flush → done
                    break
            elif etype == "error":
                print("\\n[error]", evt.get("error"))
                break`
    : `        # 3) Receive transcription events
        async for msg in ws:
            evt = json.loads(msg)
            etype = evt.get("type", "")
            if etype.endswith("transcription.delta"):
                print(evt.get("delta", ""), end="", flush=True)
            elif etype.endswith("transcription.completed"):
                print("\\n[done]", evt.get("transcript", ""))
                break
            elif etype == "error":
                print("\\n[error]", evt.get("error"))
                break`;
  const flushedDecl = vad ? '\n        flushed = asyncio.Event()  # set once the whole stream is sent + flushed\n' : '';
  const flushedSet = vad ? '\n            flushed.set()' : '';
  return `# pip install websockets
import asyncio
import base64
import json
import os
import websockets

# Realtime transcription is a WebSocket session: model must be in the handshake URL.
URL = "${ctx.url}"

async def main():
    # websockets >= 13 uses additional_headers; older versions use extra_headers
    async with websockets.connect(
        URL, additional_headers={"Authorization": "Bearer " + ${ENV_KEY_EXPR.python}}
    ) as ws:
        # 1) Configure the transcription session (${configNote})
        await ws.send(json.dumps(${sessionStr}))
${flushedDecl}
        # 2) Stream raw PCM16 / ${RT_SAMPLE_RATE / 1000}kHz / mono audio in ~${RT_CHUNK_MS}ms chunks
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
            # ${commitNote}
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))${flushedSet}

        asyncio.create_task(send_audio())

${recvLoop}

asyncio.run(main())`;
}
