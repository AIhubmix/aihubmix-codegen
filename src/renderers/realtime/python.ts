/**
 * Realtime 转录 Python renderer：原生 websockets（依赖最少，官方 SDK 版见 docs）。
 * 三段式：session.update 首帧 → append/commit 推流 → 事件循环收 delta/completed。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { RT_CHUNK_MS, RT_SAMPLE_RATE } from '../../config/realtime.js';
import { pyLiteral } from '../../emit/literal.js';
import type { RealtimeCtx } from '../../wire/realtime.js';

export function realtimePy(ctx: RealtimeCtx): string {
  const sessionStr = pyLiteral(ctx.session, '        ');
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
        # 1) Configure the transcription session (first frame; turn_detection must stay null)
        await ws.send(json.dumps(${sessionStr}))

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
            # No VAD in transcription sessions: commit manually to finalize the segment
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

        asyncio.create_task(send_audio())

        # 3) Receive transcription events
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
                break

asyncio.run(main())`;
}
