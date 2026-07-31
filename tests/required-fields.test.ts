/**
 * 协议必填字段 —— buildBody 的内建约定,不靠调用方传对。
 *
 * canon/schema 层不下发 required(那是协议契约、闭集,住本包),所以「必填字段恒在」
 * 只有这里能保证。缺了就是上游 400:
 *   chat / messages → messages 数组非空;messages 另须 max_tokens(Anthropic 硬性必填)
 *   responses       → input 非空
 *   gemini          → contents 数组非空(Google 硬性必填)
 *
 * 边界特意打空值:ctx.messages 传空数组([] 是真值,天然的 if(hist) 陷阱)、user 空串、
 * 会话缺失 —— 任何一种都不许让必填字段消失或变成空数组。
 */
import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/wire/body.js';
import { baseCtx, ctxWith } from './fixture.js';

const variants = [
  { name: '常规', ctx: baseCtx },
  { name: '空 paramKeys', ctx: ctxWith({ paramKeys: [] }) },
  { name: 'messages 为空数组', ctx: ctxWith({ messages: [] }) },
  { name: 'user 空串', ctx: ctxWith({ user: '' }) },
  { name: 'user 空串 + messages 空数组', ctx: ctxWith({ user: '', messages: [] }) },
];

describe('协议必填字段恒在', () => {
  for (const { name, ctx } of variants) {
    it(`chat / messages 的 messages 数组非空(${name})`, () => {
      for (const proto of ['chat', 'messages'] as const) {
        const b = buildBody(proto, ctx) as { messages?: unknown[] };
        expect(Array.isArray(b.messages), proto).toBe(true);
        expect(b.messages!.length, proto).toBeGreaterThan(0);
      }
    });

    it(`messages 的 max_tokens 恒在(${name})`, () => {
      const b = buildBody('messages', ctx) as { max_tokens?: number };
      expect(typeof b.max_tokens).toBe('number');
      expect(b.max_tokens).toBeGreaterThan(0);
    });

    it(`responses 的 input 非空(${name})`, () => {
      const b = buildBody('responses', ctx) as { input?: unknown };
      const inp = b.input;
      expect(inp !== undefined && inp !== null, 'input 缺失').toBe(true);
      if (Array.isArray(inp)) expect(inp.length).toBeGreaterThan(0);
    });

    it(`gemini 的 contents 数组非空(${name})`, () => {
      const b = buildBody('gemini', ctx) as { contents?: unknown[] };
      expect(Array.isArray(b.contents)).toBe(true);
      expect(b.contents!.length).toBeGreaterThan(0);
      // 每条都得有 parts —— contents:[{}] 形态照样 400
      for (const c of b.contents as Array<{ parts?: unknown[] }>) {
        expect(Array.isArray(c.parts)).toBe(true);
        expect(c.parts!.length).toBeGreaterThan(0);
      }
    });
  }
});
