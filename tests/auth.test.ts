/**
 * 鉴权头与路由 —— 这套事实原先在 goRaw / javaRaw / csRaw / curl / rubyGemini 五个 renderer
 * 里各写了一份三分支 ternary，`anthropic-version` 字面量出现 5 次。抽进 config 之后，
 * 断言只需写一遍；同时验产物里真的按协议出对了头（防止 renderer 抄漏一条）。
 */
import { describe, expect, it } from 'vitest';
import { API_KEY_PLACEHOLDER } from '../src/config/placeholders.js';
import { UPSTREAM } from '../src/config/protocols.js';
import { sdkDef } from '../src/config/sdk.js';
import type { CodeProto } from '../src/types.js';
import { authHeaders } from '../src/wire/auth.js';
import { endpointPath } from '../src/wire/endpoint.js';
import { generateCode } from '../src/generate.js';
import { baseCtx, ctxWith } from './fixture.js';

describe('authHeaders', () => {
  it('chat / responses 走 Authorization: Bearer', () => {
    for (const proto of ['chat', 'responses'] as const) {
      const hs = authHeaders(proto);
      expect(hs, proto).toContainEqual({ name: 'Authorization', value: `Bearer ${API_KEY_PLACEHOLDER}` });
    }
  });

  it('gemini 走 x-goog-api-key', () => {
    const hs = authHeaders('gemini');
    expect(hs).toContainEqual({ name: 'x-goog-api-key', value: API_KEY_PLACEHOLDER });
    expect(hs.some((h) => h.name === 'Authorization')).toBe(false);
  });

  it('messages 走 x-api-key，并带 anthropic-version', () => {
    const hs = authHeaders('messages');
    expect(hs).toContainEqual({ name: 'x-api-key', value: API_KEY_PLACEHOLDER });
    expect(hs).toContainEqual({ name: 'anthropic-version', value: UPSTREAM.anthropicVersion });
    expect(hs.some((h) => h.name === 'Authorization')).toBe(false);
  });

  it('key 占位可覆盖（消费端要生成 $VAR / process.env.X 等不同写法）', () => {
    expect(authHeaders('messages', '$MY_KEY')).toContainEqual({ name: 'x-api-key', value: '$MY_KEY' });
  });
});

describe('endpointPath', () => {
  it('四条路由按协议出，gemini 的 {model} 被 URL-encode', () => {
    expect(endpointPath('chat', baseCtx)).toBe('/v1/chat/completions');
    expect(endpointPath('messages', baseCtx)).toBe('/v1/messages');
    expect(endpointPath('responses', baseCtx)).toBe('/v1/responses');
    expect(endpointPath('gemini', ctxWith({ model: { id: 'models/gemini-3.6' } })))
      .toBe('/gemini/v1beta/models/models%2Fgemini-3.6:generateContent');
  });

  it('路径不出现双斜杠（线上 model.constant.js:346 的 `//v1/messages` 回归）', () => {
    for (const proto of ['chat', 'messages', 'responses', 'gemini'] as const) {
      const url = baseCtx.baseUrl + endpointPath(proto, baseCtx);
      expect(url.slice('https://'.length), proto).not.toContain('//');
    }
  });
});

describe('产物里的鉴权头（renderer 没抄漏）', () => {
  // 原生 REST 单元格自己把头写进请求，最能反映「有哪些头」；SDK 单元格由 SDK 自己带头，不检。
  // 哪些格子是 SDK 型不写死在这里 —— 以 config/sdk.ts 有没有记录为准（go 只有 chat 一格是
  // SDK 型，其余三协议走 goRaw）。这样将来给某语言补一条 SDK 记录，本测试自动跟着放行，
  // 不会因为「新加了 SDK 实现」而红成假故障。
  const CANDIDATES = ['curl', 'go', 'java', 'csharp'] as const;
  const rawLangs = (proto: CodeProto) => CANDIDATES.filter((l) => !sdkDef(l, proto));

  it('messages 的原生 REST 示例都带 x-api-key 与 anthropic-version', () => {
    for (const lang of rawLangs('messages')) {
      const code = generateCode('messages', lang, baseCtx);
      expect(code, lang).toContain('x-api-key');
      expect(code, lang).toContain(UPSTREAM.anthropicVersion);
      expect(code, lang).not.toContain('Authorization');
    }
  });

  it('gemini 的原生 REST 示例都带 x-goog-api-key', () => {
    for (const lang of rawLangs('gemini')) {
      const code = generateCode('gemini', lang, baseCtx);
      expect(code, lang).toContain('x-goog-api-key');
    }
  });

  it('chat 的原生 REST 示例都带 Authorization: Bearer', () => {
    const langs = rawLangs('chat');
    expect(langs, 'go chat 是 SDK 单元格，不该出现在原生 REST 名单里').toEqual(['curl', 'java', 'csharp']);
    for (const lang of langs) {
      const code = generateCode('chat', lang, baseCtx);
      expect(code, lang).toContain('Bearer ');
      expect(code, lang).not.toContain('x-api-key');
    }
  });

  it('go chat 走 SDK：不手写头，由 go-openai 的 config 带 key', () => {
    const code = generateCode('chat', 'go', baseCtx);
    expect(code).toContain('openai.NewClientWithConfig');
    expect(code).not.toContain('req.Header.Set');
  });

  it('curl 出 shell 变量而不是 key 字面量（复制即跑，别把真 key 打进 shell 历史）', () => {
    // curl 是唯一「粘进终端就发出去」的语言。出字面量意味着用户要么先手改一处，
    // 要么把 key 直接敲进命令行。媒体 curl 一直是 $VAR 形态，这里对齐。
    for (const proto of ['chat', 'messages', 'responses', 'gemini'] as const) {
      const code = generateCode(proto, 'curl', baseCtx);
      expect(code, proto).toContain(`$${API_KEY_PLACEHOLDER}`);
      // 反面：不许有裸占位符（前面不带 $ 的那种）。去掉所有 `$占位符` 之后就不该再出现它。
      expect(code.split(`$${API_KEY_PLACEHOLDER}`).join(''), proto)
        .not.toContain(API_KEY_PLACEHOLDER);
    }
  });
});
