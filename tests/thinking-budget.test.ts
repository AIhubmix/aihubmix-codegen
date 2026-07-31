/**
 * Anthropic 硬约束：`max_tokens` 必须严格大于 `thinking.budget_tokens`，否则 400。
 *
 * 这条以前住在包外的能力注入层里，后果是**只有代码示例受保护、真实请求不受保护** ——
 * playground 的参数面板可以把 budget 调到 8192、max_tokens 留在 1024，那一发直接 400，
 * 而同一屏的 Get Code 出的示例却是好的。同一个不变量在两条路径上行为不同，本身就是 bug。
 *
 * 所以这里**不经能力层**，直接调 buildBody —— 断言的是真实请求走的那条路径。
 */
import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/wire/body.js';
import { ctxWith } from './fixture.js';

/** 直接构造一个「开了 thinking、budget 超过 max_tokens」的 ctx（能力层不参与）。 */
function messagesBody(patch: { max_tokens: number; thinking?: Record<string, unknown> }) {
  return buildBody(
    'messages',
    ctxWith({
      think: true,
      p: { max_tokens: patch.max_tokens, temperature: 0.7, top_p: 0.9 },
      objects: patch.thinking ? { thinking: patch.thinking } : undefined,
    }),
  );
}

describe('buildBody(messages) 自己纠正 max_tokens ≤ budget_tokens', () => {
  it('超限时抬到 budget + 1024（留出写答案的额度，不是 budget + 1）', () => {
    const b = messagesBody({ max_tokens: 1024, thinking: { budget_tokens: 8192 } });
    expect((b.thinking as Record<string, unknown>).budget_tokens).toBe(8192);
    expect(b.max_tokens).toBe(8192 + 1024);
  });

  it('恰好相等也要抬 —— 约束是严格大于，不是大于等于', () => {
    const b = messagesBody({ max_tokens: 4096, thinking: { budget_tokens: 4096 } });
    expect(b.max_tokens).toBe(4096 + 1024);
  });

  it('已经够大就原样保留，不擅自改用户填的值', () => {
    const b = messagesBody({ max_tokens: 16384, thinking: { budget_tokens: 4096 } });
    expect(b.max_tokens).toBe(16384);
  });

  it('没开 thinking 时不碰 max_tokens', () => {
    const b = buildBody('messages', ctxWith({ p: { max_tokens: 512, temperature: 0.7, top_p: 0.9 } }));
    expect(b.thinking).toBeUndefined();
    expect(b.max_tokens).toBe(512);
  });

  it('开了 thinking 但没填 budget_tokens（adaptive / 用户未填）时不碰 max_tokens', () => {
    // 面板没给默认值就是没有 —— 此时约束不适用，抬 max_tokens 反而是编造。
    const b = messagesBody({ max_tokens: 512 });
    expect((b.thinking as Record<string, unknown>).budget_tokens).toBeUndefined();
    expect(b.max_tokens).toBe(512);
  });

  it('budget_tokens 不是数字（脏值）时按「没填」处理，不产生 NaN', () => {
    const b = messagesBody({ max_tokens: 512, thinking: { budget_tokens: '8192' } });
    expect(b.max_tokens).toBe(512);
  });

  it('只作用于 messages —— 另外三个协议没有数值预算，不该被改', () => {
    for (const proto of ['chat', 'responses', 'gemini'] as const) {
      const b = buildBody(
        proto,
        ctxWith({
          think: true,
          p: { max_tokens: 1024, temperature: 0.7, top_p: 0.9 },
          objects: { thinking: { budget_tokens: 8192 } },
        }),
      );
      const max = proto === 'responses' ? b.max_output_tokens : b.max_tokens;
      if (proto !== 'gemini') expect(max, `${proto} 的输出上限被误改`).toBe(1024);
    }
  });
});
