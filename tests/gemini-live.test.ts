/**
 * Gemini Live（generateGeminiLiveCode）—— wire 形状 + 7 语言格防伪。
 *
 * 线上实测（2026-11-19）倒推的红线：
 * - responseModalities 绝不能是 ["TEXT"]（两个模型都 1007 关会话）。
 * - 数字人：responseModalities 恰为 ["VIDEO"] 且带 avatarConfig.avatarName（网关拒混合模态、拒空名）。
 * - 输入音频 16kHz（不是 OpenAI realtime 的 24kHz）。
 * - 与 OpenAI realtime 不串味：不出现 session.update / input_audio_buffer。
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { GL_AVATARS, GL_INPUT_AUDIO_MIME } from '../src/config/gemini-live.js';
import { generateGeminiLiveCode } from '../src/generate.js';
import {
  buildGeminiLiveSetup,
  geminiLiveAudioFrame,
  geminiLiveAudioStreamEnd,
  geminiLiveTextFrame,
  geminiLiveVideoFrame,
  geminiLiveWsUrl,
} from '../src/wire/gemini-live.js';
import type { GeminiLiveCodeGenOpts } from '../src/types.js';

const INFERERA = 'https://api.inferera.com';
const MODEL = 'gemini-3.8-live';
const PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const opts = (over: Partial<GeminiLiveCodeGenOpts> = {}): GeminiLiveCodeGenOpts => ({
  baseUrl: INFERERA,
  modelId: MODEL,
  lang: 'python',
  ...over,
});

describe('geminiLiveWsUrl', () => {
  it('https → wss，model 落 query 且转义', () => {
    expect(geminiLiveWsUrl(INFERERA, MODEL)).toBe(`wss://api.inferera.com${PATH}?model=${MODEL}`);
    expect(geminiLiveWsUrl('http://localhost:5173', 'a b')).toBe(`ws://localhost:5173${PATH}?model=a%20b`);
  });
});

describe('buildGeminiLiveSetup', () => {
  it('缺省：AUDIO 回复 + 双向转写，model 与握手同名，不拼可选项', () => {
    const s = buildGeminiLiveSetup(opts()) as any;
    expect(Object.keys(s)).toEqual(['setup']);
    expect(s.setup.model).toBe(`models/${MODEL}`);
    expect(s.setup.generationConfig).toEqual({ responseModalities: ['AUDIO'] });
    expect(s.setup.inputAudioTranscription).toEqual({});
    expect(s.setup.outputAudioTranscription).toEqual({});
    for (const k of ['systemInstruction', 'avatarConfig', 'tools']) expect(s.setup).not.toHaveProperty(k);
    expect(s.setup.generationConfig).not.toHaveProperty('maxOutputTokens');
  });

  it('红线：任何组合都不会产出 ["TEXT"] 或混合模态', () => {
    for (const output of [undefined, 'audio', 'avatar'] as const) {
      for (const transcripts of [true, false]) {
        const m = (buildGeminiLiveSetup(opts({ output, transcripts })) as any).setup.generationConfig
          .responseModalities;
        expect(m).toHaveLength(1);
        expect(m[0]).not.toBe('TEXT');
      }
    }
  });

  it('voice / instructions / mediaResolution 透出并 trim；空串不拼', () => {
    const s = buildGeminiLiveSetup(
      opts({ voice: ' Kore ', instructions: '  Be brief. ', mediaResolution: 'MEDIA_RESOLUTION_LOW' }),
    ) as any;
    expect(s.setup.generationConfig.speechConfig).toEqual({
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
    });
    expect(s.setup.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');
    expect(s.setup.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });

    const bare = buildGeminiLiveSetup(opts({ voice: '  ', instructions: '  ' })) as any;
    expect(bare.setup.generationConfig).not.toHaveProperty('speechConfig');
    expect(bare.setup).not.toHaveProperty('systemInstruction');
  });

  it('transcripts:false 关掉两路转写', () => {
    const s = buildGeminiLiveSetup(opts({ transcripts: false })) as any;
    expect(s.setup).not.toHaveProperty('inputAudioTranscription');
    expect(s.setup).not.toHaveProperty('outputAudioTranscription');
  });

  it('数字人：恰为 ["VIDEO"] + avatarName；空名回落首个预置形象', () => {
    const s = buildGeminiLiveSetup(opts({ output: 'avatar', avatarName: 'Ben' })) as any;
    expect(s.setup.generationConfig.responseModalities).toEqual(['VIDEO']);
    expect(s.setup.avatarConfig).toEqual({ avatarName: 'Ben' });
    const d = buildGeminiLiveSetup(opts({ output: 'avatar', avatarName: ' ' })) as any;
    expect(d.setup.avatarConfig).toEqual({ avatarName: GL_AVATARS[0] });
  });
});

describe('输入帧', () => {
  it('音频 16kHz、视频 JPEG、文字、尾段冲刷，形状与网关白名单一致', () => {
    expect(geminiLiveAudioFrame('AAA=')).toEqual({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AAA=' } },
    });
    expect(GL_INPUT_AUDIO_MIME).toBe('audio/pcm;rate=16000');
    expect(geminiLiveVideoFrame('/9j/')).toEqual({
      realtimeInput: { video: { mimeType: 'image/jpeg', data: '/9j/' } },
    });
    expect(geminiLiveTextFrame('hi')).toEqual({ realtimeInput: { text: 'hi' } });
    expect(geminiLiveAudioStreamEnd()).toEqual({ realtimeInput: { audioStreamEnd: true } });
  });
});

describe('generateGeminiLiveCode：7 语言格防伪', () => {
  const wsUrl = geminiLiveWsUrl(INFERERA, MODEL);

  it('每格含 wss URL 与 16kHz 音频帧，且不串 OpenAI realtime / HTTP / 中文 / 硬编码 key', () => {
    for (const output of ['audio', 'avatar'] as const) {
      for (const lang of LANGS) {
        const code = generateGeminiLiveCode(opts({ lang: lang.id, output, video: true }));
        const where = `gemini-live/${output}/${lang.id}`;
        expect(code.trim(), `${where} 空产物`).not.toBe('');
        expect(code, `${where} 缺 wss URL`).toContain(wsUrl);
        expect(code, `${where} 残留旧域`).not.toContain('aihubmix.com');
        expect(code, `${where} 缺 16kHz 音频帧`).toContain('audio/pcm;rate=16000');
        expect(code, `${where} 串了 OpenAI realtime`).not.toMatch(/session\.update|input_audio_buffer/);
        expect(code, `${where} 混入 HTTP 调用`).not.toMatch(
          /requests\.post|fetch\(|http\.Post|HttpRequest\.newBuilder/,
        );
        expect(code, `${where} 出现中文`).not.toMatch(/[一-鿿]/);
        expect(code, `${where} 疑似硬编码 key`).not.toMatch(/sk-[A-Za-z0-9]/);
      }
    }
  });

  it('精品格（python/typescript）含 setup、等 setupComplete、读转写与 turnComplete', () => {
    for (const lang of ['python', 'javascript'] as const) {
      const code = generateGeminiLiveCode(opts({ lang, voice: 'Kore', instructions: 'Be brief.' }));
      for (const needle of ['setupComplete', 'realtimeInput', 'outputTranscription', 'turnComplete', 'interrupted', 'Kore', 'audioStreamEnd']) {
        expect(code, `${lang} 缺 ${needle}`).toContain(needle);
      }
    }
  });

  it('数字人格落 .mp4、语音格落 24k raw；video 开关只影响示例里的 JPEG 帧', () => {
    for (const lang of ['python', 'javascript'] as const) {
      expect(generateGeminiLiveCode(opts({ lang, output: 'avatar' }))).toContain('avatar_reply.mp4');
      expect(generateGeminiLiveCode(opts({ lang }))).toContain('reply_pcm16_24k.raw');
      expect(generateGeminiLiveCode(opts({ lang }))).not.toContain('image/jpeg');
      expect(generateGeminiLiveCode(opts({ lang, video: true }))).toContain('image/jpeg');
    }
  });

  it('降级格（go/java/csharp/ruby）是注释块且指向精品格', () => {
    for (const lang of ['go', 'java', 'csharp', 'ruby'] as const) {
      const code = generateGeminiLiveCode(opts({ lang }));
      const prefix = lang === 'ruby' ? '#' : '//';
      for (const line of code.split('\n')) {
        expect(line.startsWith(prefix), `gemini-live/${lang} 出现非注释行: ${line}`).toBe(true);
      }
      expect(code).toContain('Python or TypeScript');
    }
  });

  it('换 base 只换 base：产物其余字节逐字相同', () => {
    const a = generateGeminiLiveCode(opts({ lang: 'python' }));
    const b = generateGeminiLiveCode(opts({ lang: 'python', baseUrl: 'https://aihubmix.com' }));
    expect(b.replaceAll('wss://aihubmix.com', 'wss://api.inferera.com')).toBe(a);
  });
});
