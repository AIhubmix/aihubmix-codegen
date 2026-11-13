/**
 * 基础模式（TASK-CZ5KYA）—— 调用方不给 max_tokens 时的下发约定。
 *
 * schema 未收录的新模型上限未知，playground 走「只发 model + messages」的基础请求：
 *   chat / responses → 不带任何上限字段（交给上游默认）
 *   messages         → Anthropic 硬性必填，补 MESSAGES_DEFAULT_MAX_TOKENS
 * 且 Get Code 各语言与 body 同口径（Go 渲染器是唯一直接引用 p.max_tokens 的格）。
 */
import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/wire/body.js';
import { generateCode } from '../src/index.js';
import { MESSAGES_DEFAULT_MAX_TOKENS } from '../src/config/wire-policy.js';
import { baseCtx } from './fixture.js';
import type { CodeGenCtx } from '../src/types.js';

/** 基础模式 ctx：无 schema（paramKeys undefined）、无上限、其余参数取中性值。 */
const basic: CodeGenCtx = {
  ...baseCtx,
  sys: '',
  paramKeys: undefined,
  messages: undefined,
  p: { temperature: 1, top_p: 1 },
  tools: null,
  structured: null,
  think: false,
  cache: false,
  enums: undefined,
  objects: undefined,
};

const LIMIT_KEYS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'];

describe('基础模式：max_tokens 缺省', () => {
  it('chat 只发 model + messages + stream', () => {
    const b = buildBody('chat', basic);
    expect(Object.keys(b).sort()).toEqual(['messages', 'model', 'stream']);
  });

  it('chat 声明 max_completion_tokens 时同样不发上限', () => {
    const b = buildBody('chat', { ...basic, paramKeys: ['max_completion_tokens'] });
    for (const k of LIMIT_KEYS) expect(b, k).not.toHaveProperty(k);
  });

  it('responses 不发 max_output_tokens', () => {
    const b = buildBody('responses', basic);
    expect(Object.keys(b).sort()).toEqual(['input', 'model', 'stream']);
  });

  it('messages 补默认 max_tokens（Anthropic 必填）', () => {
    const b = buildBody('messages', basic);
    expect(b.max_tokens).toBe(MESSAGES_DEFAULT_MAX_TOKENS);
    expect(Object.keys(b).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  });

  it('给了上限照旧下发（不回归）', () => {
    const ctx = { ...basic, p: { ...basic.p, max_tokens: 777 } };
    expect(buildBody('chat', ctx).max_tokens).toBe(777);
    expect(buildBody('responses', ctx).max_output_tokens).toBe(777);
    expect(buildBody('messages', ctx).max_tokens).toBe(777);
  });

  it('Go 示例不渲染 MaxTokens / MaxCompletionTokens，也不出现 undefined', () => {
    for (const id of ['basic-model', 'gpt-5-mini']) {
      const code = generateCode('chat', 'go', { ...basic, model: { id } });
      expect(code, id).not.toMatch(/MaxTokens|MaxCompletionTokens/);
      expect(code, id).not.toContain('undefined');
    }
  });

  it('所有语言 × 三协议的示例都不含 undefined', () => {
    for (const proto of ['chat', 'messages', 'responses'] as const) {
      for (const lang of ['curl', 'python', 'javascript', 'go', 'java', 'csharp', 'ruby'] as const) {
        const code = generateCode(proto, lang, basic);
        expect(code, `${proto}/${lang}`).not.toContain('undefined');
      }
    }
  });
});
