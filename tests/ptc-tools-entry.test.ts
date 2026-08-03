/**
 * PTC(程序化工具调用)—— responses 协议的 tools 数组头部常量条目。
 * spec: ProgrammaticToolCallingParam {type:'programmatic_tool_calling'};仅 responses 有此形态
 * (chat 官方仅 function;messages 走 code_execution+allowed_callers,本轮未实现)。
 */
import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/wire/body.js';
import { ctxWith, TOOLS } from './fixture.js';

const PTC_KEY = 'tools[].programmatic_tool_calling';

describe('PTC tools 条目(responses)', () => {
  it('ptc+tools+schema 声明 → tools 头部出现常量条目', () => {
    const b = buildBody('responses', ctxWith({ tools: TOOLS, ptc: true, paramKeys: [PTC_KEY] })) as {
      tools: Array<{ type: string }>;
    };
    expect(b.tools[0]).toEqual({ type: 'programmatic_tool_calling' });
    expect(b.tools.length).toBe(TOOLS.length + 1);
  });

  it('schema 未声明该字段 → 不插(inSchema 门控)', () => {
    const b = buildBody('responses', ctxWith({ tools: TOOLS, ptc: true, paramKeys: ['tools'] })) as {
      tools: Array<{ type: string }>;
    };
    expect(b.tools.some((t) => t.type === 'programmatic_tool_calling')).toBe(false);
  });

  it('ptc 开但 tools 未启用 → 整个 tools 能力不发', () => {
    const b = buildBody('responses', ctxWith({ tools: null, ptc: true, paramKeys: [PTC_KEY] })) as Record<
      string,
      unknown
    >;
    expect('tools' in b).toBe(false);
  });

  it('chat/messages/gemini 忽略 ptc 标志', () => {
    for (const proto of ['chat', 'messages', 'gemini'] as const) {
      const b = buildBody(proto, ctxWith({ tools: TOOLS, ptc: true, paramKeys: [PTC_KEY] })) as {
        tools?: Array<Record<string, unknown>>;
      };
      const arr = b.tools ?? [];
      expect(
        arr.some((t) => t.type === 'programmatic_tool_calling'),
        `${proto} 不应出现 PTC 条目`,
      ).toBe(false);
    }
  });
});
