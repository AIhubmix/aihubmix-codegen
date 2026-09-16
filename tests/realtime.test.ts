/**
 * Realtime 转录（generateRealtimeCode）—— 独立传输形态的防伪断言。
 *
 * 为什么断言写得这么凶：另两张表的经验是「渲染器缺格会静默兜底出别的协议的代码，
 * 非空断言照样绿」。realtime 是 WS，一旦兜到 HTTP 模板，产物是完全错的还看不出来。
 * 所以每格都正向断 wss 握手 URL、反向断不含 HTTP 动词调用形态。
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { generateRealtimeCode } from '../src/generate.js';
import { buildRealtimeSession, realtimeWsUrl } from '../src/wire/realtime.js';
import type { RealtimeCodeGenOpts } from '../src/types.js';

const INFERERA = 'https://api.inferera.com';
const MODEL = 'gpt-live-transcribe';

const optsWith = (over: Partial<RealtimeCodeGenOpts> = {}): RealtimeCodeGenOpts => ({
  baseUrl: INFERERA,
  modelId: MODEL,
  lang: 'python',
  ...over,
});

describe('realtimeWsUrl', () => {
  it('https → wss，query 带 intent 与 model（网关握手期硬性要求）', () => {
    expect(realtimeWsUrl(INFERERA, MODEL)).toBe(
      `wss://api.inferera.com/v1/realtime?intent=transcription&model=${MODEL}`,
    );
  });

  it('model 过 URL 编码', () => {
    expect(realtimeWsUrl(INFERERA, 'a/b')).toContain('model=a%2Fb');
  });
});

describe('buildRealtimeSession', () => {
  it('最小载荷：type/format/model 钉死，turn_detection 恒 null', () => {
    const s = buildRealtimeSession(optsWith()) as any;
    expect(s.type).toBe('session.update');
    expect(s.session.type).toBe('transcription');
    const input = s.session.audio.input;
    expect(input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(input.transcription.model).toBe(MODEL);
    // 显式 null 是协议要求（非 null 被模型推理商 invalid_value 拒），不能被裁剪成 undefined
    expect(input).toHaveProperty('turn_detection', null);
    expect(input.noise_reduction).toBeUndefined();
  });

  it('可选参数全量透出；空数组/空串不出现', () => {
    const s = buildRealtimeSession(
      optsWith({
        languages: ['en', 'zh'],
        prompt: '  meeting notes  ',
        keywords: ['AiHubMix'],
        delay: 'low',
        noiseReduction: 'near_field',
      }),
    ) as any;
    const input = s.session.audio.input;
    expect(input.transcription).toEqual({
      model: MODEL,
      languages: ['en', 'zh'],
      prompt: 'meeting notes',
      keywords: ['AiHubMix'],
      delay: 'low',
    });
    expect(input.noise_reduction).toEqual({ type: 'near_field' });

    const bare = buildRealtimeSession(optsWith({ languages: [], prompt: '   ', keywords: [] })) as any;
    const t = bare.session.audio.input.transcription;
    expect(t).toEqual({ model: MODEL });
  });
});

describe('generateRealtimeCode：7 语言格防伪', () => {
  const wsUrl = realtimeWsUrl(INFERERA, MODEL);

  it('每格都含 wss 握手 URL 与帧词表，不含 HTTP 调用形态', () => {
    for (const lang of LANGS) {
      const code = generateRealtimeCode(optsWith({ lang: lang.id }));
      const where = `realtime/${lang.id}`;
      expect(code.trim(), `${where} 空产物`).not.toBe('');
      expect(code, `${where} 缺 wss 握手 URL`).toContain(wsUrl);
      expect(code, `${where} 残留旧域`).not.toContain('aihubmix.com');
      expect(code, `${where} 缺 append 帧`).toContain('input_audio_buffer.append');
      expect(code, `${where} 缺 commit 帧`).toContain('input_audio_buffer.commit');
      // 兜到 HTTP 模板的典型指纹：requests.post / fetch( / http.Post / HttpRequest
      expect(code, `${where} 混入 HTTP 调用`).not.toMatch(/requests\.post|fetch\(|http\.Post|HttpRequest\.newBuilder/);
      // 对外产物全英文（output-language 只扫 PROTOCOLS 矩阵，realtime 自己守）
      expect(code, `${where} 出现中文`).not.toMatch(/[一-鿿]/);
      // key 只走环境变量，不出现字面量 key 形态
      expect(code, `${where} 疑似硬编码 key`).not.toMatch(/sk-[A-Za-z0-9]/);
    }
  });

  it('精品格（python/typescript）含 session.update 配置与事件循环', () => {
    for (const lang of ['python', 'javascript'] as const) {
      const code = generateRealtimeCode(optsWith({ lang, languages: ['en', 'zh'], delay: 'low' }));
      expect(code).toContain('session.update');
      expect(code).toContain('turn_detection');
      expect(code).toContain('transcription.delta');
      expect(code).toContain('transcription.completed');
      expect(code).toContain('"low"');
    }
  });

  it('降级格（go/java/csharp/ruby）是注释块且指向精品格', () => {
    for (const lang of ['go', 'java', 'csharp', 'ruby'] as const) {
      const code = generateRealtimeCode(optsWith({ lang }));
      const prefix = lang === 'ruby' ? '#' : '//';
      for (const line of code.split('\n')) {
        expect(line.startsWith(prefix), `realtime/${lang} 出现非注释行: ${line}`).toBe(true);
      }
      expect(code).toContain('Python or TypeScript');
    }
  });

  it('换 base 只换 base：产物其余字节逐字相同', () => {
    const a = generateRealtimeCode(optsWith({ lang: 'python' }));
    const b = generateRealtimeCode(optsWith({ lang: 'python', baseUrl: 'https://aihubmix.com' }));
    expect(b.replaceAll('wss://aihubmix.com', 'wss://api.inferera.com')).toBe(a);
  });
});
