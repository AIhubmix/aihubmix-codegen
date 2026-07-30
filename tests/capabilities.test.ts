/**
 * 能力表 —— 「加一个能力」= 加一条记录，不用在 buildBody 四个协议分支各改一处。
 *
 * 最重要的一条：CAP_GATED_WIRE_KEYS 必须等于 CAPABILITIES 各条 gatedKeys 的并集。
 * 原先两处手写，漏一边就会「关掉能力后残留值仍被发出」——那是个静默的、只在用户
 * 关掉开关时才现形的 bug。
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAP_GATED_WIRE_KEYS } from '../src/wire/capabilities.js';
import { buildBody } from '../src/wire/body.js';
import { ctxWith, STRUCTURED, TOOLS } from './fixture.js';

describe('CAP_GATED_WIRE_KEYS 与 CAPABILITIES 同源', () => {
  it('键集合完全相等', () => {
    const fromTable = new Set(CAPABILITIES.flatMap((c) => c.gatedKeys));
    expect([...CAP_GATED_WIRE_KEYS].sort()).toEqual([...fromTable].sort());
  });

  it('每条能力至少覆盖一个协议，且 id 不重复', () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size, `能力 id 重复：${ids}`).toBe(ids.length);
    for (const cap of CAPABILITIES) {
      expect(Object.keys(cap.emit).length, `${cap.id} 一个协议都没覆盖`).toBeGreaterThan(0);
    }
  });
});

describe('能力关掉则整块不发（含 gatedKeys 的残留值）', () => {
  // 参数面板里配过 thinking/reasoning/text/parallel_tool_calls 的值，但能力开关是关的：
  // 这些键一律不能进 body —— 它们由能力门控下发，不走通用 emitObjects。
  const leftovers = {
    thinking: { budget_tokens: 4096 },
    reasoning: { summary: 'auto' },
    text: { verbosity: 'low' },
    parallel_tool_calls: false,
  };

  it('think / structured / tools 全关时，残留值一个都不下发', () => {
    for (const proto of ['chat', 'messages', 'responses', 'gemini'] as const) {
      const b = buildBody(proto, ctxWith({ objects: leftovers }));
      for (const key of CAP_GATED_WIRE_KEYS) {
        expect(key in b, `${proto} 泄漏了 ${key}`).toBe(false);
      }
      expect('tools' in b, `${proto} 没开 tools 却发了 tools`).toBe(false);
    }
  });

  it('开了 tools 才发 tools / parallel_tool_calls', () => {
    for (const proto of ['chat', 'messages', 'responses', 'gemini'] as const) {
      const b = buildBody(proto, ctxWith({ objects: leftovers, tools: TOOLS }));
      expect(b.tools, `${proto} tools`).toBeTruthy();
      expect(b.parallel_tool_calls, `${proto} parallel_tool_calls`).toBe(false);
    }
  });

  it('开了 structured 才发对应形态（chat=response_format / responses=text / messages=output_config）', () => {
    const ctx = ctxWith({ structured: STRUCTURED });
    expect(buildBody('chat', ctx).response_format).toBeTruthy();
    expect(buildBody('responses', ctx).text).toBeTruthy();
    expect(buildBody('messages', ctx).output_config).toBeTruthy();
    // gemini 的结构化走 generationConfig.responseMimeType/responseSchema（enum 通道），不经能力表
    expect('text' in buildBody('gemini', ctx)).toBe(false);
  });

  it('开了 think 才发对应形态（chat=reasoning_effort / responses=reasoning / messages=thinking）', () => {
    const ctx = ctxWith({ think: true, thinkLevel: 'high' });
    expect(buildBody('chat', ctx).reasoning_effort).toBe('high');
    expect(buildBody('responses', ctx).reasoning).toMatchObject({ effort: 'high' });
    expect(buildBody('messages', ctx).thinking).toMatchObject({ type: 'enabled' });
    // adaptive：effort 直发 output_config，不经本地预算档换算
    const adaptive = buildBody('messages', ctxWith({ think: true, thinkLevel: 'xhigh', thinkAdaptive: true }));
    expect(adaptive.thinking).toEqual({ type: 'adaptive' });
    expect(adaptive.output_config).toMatchObject({ effort: 'xhigh' });
  });
});
