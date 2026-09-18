/**
 * Realtime 对话（generateRealtimeCode kind='conversation'）—— 与转录同源的防伪断言，
 * 外加对话专属的 1008 红线守卫：**帧里绝不能出现 input.transcription**（带上=网关关整条会话），
 * 且接收循环收的是音频回放（response.audio.delta）而非转录收字。
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { generateRealtimeCode } from '../src/generate.js';
import { buildConversationSession, realtimeWsUrl } from '../src/wire/realtime.js';
import type { RealtimeCodeGenOpts } from '../src/types.js';

const INFERERA = 'https://api.inferera.com';
const MODEL = 'gpt-realtime-2.1';

const convOpts = (over: Partial<RealtimeCodeGenOpts> = {}): RealtimeCodeGenOpts => ({
  kind: 'conversation',
  baseUrl: INFERERA,
  modelId: MODEL,
  lang: 'python',
  ...over,
});

describe('realtimeWsUrl(conversation)', () => {
  it('对话握手去 intent：只带 model（kind 由网关按模型名推导）', () => {
    expect(realtimeWsUrl(INFERERA, MODEL, 'conversation')).toBe(
      `wss://api.inferera.com/v1/realtime?model=${MODEL}`,
    );
  });

  it('缺省仍是转录（带 intent），不影响既有 lane', () => {
    expect(realtimeWsUrl(INFERERA, MODEL)).toContain('intent=transcription');
  });
});

describe('buildConversationSession：白名单帧（1008 红线）', () => {
  it('钉 type/format/voice/server_vad，且绝不含 input.transcription', () => {
    const s = buildConversationSession(convOpts()) as any;
    expect(s.type).toBe('session.update');
    expect(s.session.type).toBe('realtime');

    const input = s.session.audio.input;
    expect(input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    // 显式 server_vad：客户端靠服务端 VAD 自动起 response，不发 response.create
    expect(input.turn_detection).toEqual({ type: 'server_vad' });
    // ⚠️ 红线：带上 transcription（哪怕 null）都可能触网关消毒 → 这里必须整键缺席
    expect(input).not.toHaveProperty('transcription');

    const output = s.session.audio.output;
    expect(output.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(output.voice).toBe('marin'); // RT_DEFAULT_VOICE

    // 未设 instructions → 不拼
    expect(s.session).not.toHaveProperty('instructions');
  });

  it('voice/instructions 透出；空串回默认 voice、不拼 instructions', () => {
    const s = buildConversationSession(
      convOpts({ voice: '  cedar  ', instructions: '  Be concise.  ' }),
    ) as any;
    expect(s.session.audio.output.voice).toBe('cedar');
    expect(s.session.instructions).toBe('Be concise.');

    const bare = buildConversationSession(convOpts({ voice: '   ', instructions: '   ' })) as any;
    expect(bare.session.audio.output.voice).toBe('marin');
    expect(bare.session).not.toHaveProperty('instructions');
  });

  it('对话帧与转录帧结构上不共用 transcription 键（独立 builder 佐证）', () => {
    const frame = JSON.stringify(buildConversationSession(convOpts()));
    expect(frame).not.toContain('transcription');
  });
});

describe('generateRealtimeCode(conversation)：7 语言格防伪', () => {
  const wsUrl = realtimeWsUrl(INFERERA, MODEL, 'conversation');

  it('每格含对话 wss URL（无 intent）、append 帧，且不含 commit / HTTP / 中文 / 硬编码 key', () => {
    for (const lang of LANGS) {
      const code = generateRealtimeCode(convOpts({ lang: lang.id }));
      const where = `conversation/${lang.id}`;
      expect(code.trim(), `${where} 空产物`).not.toBe('');
      expect(code, `${where} 缺对话 wss URL`).toContain(wsUrl);
      expect(code, `${where} 对话不该带 intent`).not.toContain('intent=');
      expect(code, `${where} 残留旧域`).not.toContain('aihubmix.com');
      expect(code, `${where} 缺 append 帧`).toContain('input_audio_buffer.append');
      // 对话由服务端 VAD 自动收段，绝不发 commit 帧（发了会与自动轮次打架）
      expect(code, `${where} 误发 commit 帧`).not.toContain('input_audio_buffer.commit');
      expect(code, `${where} 混入 HTTP 调用`).not.toMatch(
        /requests\.post|fetch\(|http\.Post|HttpRequest\.newBuilder/,
      );
      expect(code, `${where} 出现中文`).not.toMatch(/[一-鿿]/);
      expect(code, `${where} 疑似硬编码 key`).not.toMatch(/sk-[A-Za-z0-9]/);
    }
  });

  it('精品格（python/typescript）含对话 session.update、音频回放与助手文字事件', () => {
    for (const lang of ['python', 'javascript'] as const) {
      const code = generateRealtimeCode(convOpts({ lang, voice: 'cedar', instructions: 'Be brief.' }));
      expect(code).toContain('session.update');
      expect(code).toContain('server_vad');
      expect(code).toContain('audio.delta'); // 音频回放（base64 PCM16）
      expect(code).toContain('audio_transcript.delta'); // 助手文字
      expect(code).toContain('cedar');
      // 不该出现转录版的收字事件
      expect(code).not.toContain('transcription.completed');
    }
  });

  it('降级格（go/java/csharp/ruby）是注释块且指向精品格', () => {
    for (const lang of ['go', 'java', 'csharp', 'ruby'] as const) {
      const code = generateRealtimeCode(convOpts({ lang }));
      const prefix = lang === 'ruby' ? '#' : '//';
      for (const line of code.split('\n')) {
        expect(line.startsWith(prefix), `conversation/${lang} 出现非注释行: ${line}`).toBe(true);
      }
      expect(code).toContain('Python or TypeScript');
    }
  });

  it('换 base 只换 base：产物其余字节逐字相同', () => {
    const a = generateRealtimeCode(convOpts({ lang: 'python' }));
    const b = generateRealtimeCode(convOpts({ lang: 'python', baseUrl: 'https://aihubmix.com' }));
    expect(b.replaceAll('wss://aihubmix.com', 'wss://api.inferera.com')).toBe(a);
  });
});
