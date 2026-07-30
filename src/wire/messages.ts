/**
 * 会话消息 → 按协议的 wire 数组（codegen 与真实请求共享唯一真源）。
 */
import type { CgMsg, CodeProto, ToolCall } from '../types.js';
import { buildMediaContent } from './multimodal.js';
import { parseToolCallArgs } from './schema.js';

/** 单条消息 content：无图→原文；有图→按协议拼 content 数组（truncate=图片换占位符，供 codegen 可读）。 */
function msgContentCg(proto: CodeProto, m: CgMsg, truncate: boolean): string | unknown[] {
  if (m.images && m.images.length) return buildMediaContent(proto, m.content, m.images, { truncate });
  return m.content;
}

/** assistant.toolCalls → OpenAI chat 的 tool_calls。 */
function chatToolCallsWire(calls?: ToolCall[]): unknown[] | undefined {
  if (!calls || !calls.length) return undefined;
  return calls.map((c) => ({
    id: c.id || '',
    type: 'function',
    function: { name: c.name, arguments: typeof c.argsString === 'string' ? c.argsString : JSON.stringify(c.args ?? {}) },
  }));
}

/** assistant.toolCalls → Anthropic 的 tool_use content blocks。 */
function anthToolUseBlocks(calls?: ToolCall[]): unknown[] {
  return (calls ?? []).map((c) => ({
    type: 'tool_use',
    id: c.id || '',
    name: c.name,
    input: typeof c.args === 'string' ? parseToolCallArgs(c.args) : (c.args ?? {}),
  }));
}

/**
 * 按协议把会话历史拼成消息数组：chat/messages→messages、responses→input、gemini→contents。
 * codegen（truncate=true，图片占位）与真实请求（truncate=false）共用此函数
 * →「真实请求 == Get Code」逐字段同源（仅图片占位差异）。system 走各协议独立字段，不进本数组
 * （chat 例外：system 合并进 messages[0]）。
 */
export function buildMessages(
  proto: CodeProto,
  msgs: CgMsg[],
  sys: string,
  opts: { cache?: boolean; truncate: boolean },
): unknown[] {
  const { cache, truncate } = opts;
  if (proto === 'messages') {
    const out: Array<{ role: string; content: unknown }> = [];
    for (const m of msgs) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }] });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        blocks.push(...anthToolUseBlocks(m.toolCalls));
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: m.role, content: msgContentCg('messages', m, truncate) });
      }
    }
    // 无 system 断点时把 cache_control 打在最后一条消息的最后一个内容块。
    if (cache && !sys && out.length) {
      const last = out[out.length - 1];
      const blocks = Array.isArray(last.content) ? [...last.content] : [{ type: 'text', text: last.content }];
      const tail = blocks[blocks.length - 1];
      if (tail && typeof tail === 'object') blocks[blocks.length - 1] = { ...(tail as Record<string, unknown>), cache_control: { type: 'ephemeral' } };
      out[out.length - 1] = { role: last.role, content: blocks };
    }
    return out;
  }
  if (proto === 'responses') {
    return msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: msgContentCg('responses', m, truncate) }));
  }
  if (proto === 'gemini') {
    const contents: Array<{ role: string; parts: unknown[] }> = [];
    for (const m of msgs) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        contents.push({ role: 'user', parts: [{ functionResponse: { name: m.toolCallId || '', response: { result: m.content } } }] });
      } else if (m.role === 'assistant' && m.toolCalls?.length) {
        const parts: unknown[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls)
          parts.push({ functionCall: { name: c.name, args: typeof c.args === 'string' ? parseToolCallArgs(c.args) : (c.args ?? {}) } });
        contents.push({ role: 'model', parts });
      } else {
        const content = msgContentCg('gemini', m, truncate);
        const parts = Array.isArray(content) ? content : [{ text: content }];
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
      }
    }
    return contents;
  }
  // chat：system 合并进 messages[0]；assistant 带 tool_calls；tool 结果用 role:"tool"。
  const out: Array<Record<string, unknown>> = [];
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId || '', content: m.content });
    } else {
      const entry: Record<string, unknown> = { role: m.role, content: msgContentCg('chat', m, truncate) };
      const tc = m.role === 'assistant' ? chatToolCallsWire(m.toolCalls) : undefined;
      if (tc) entry.tool_calls = tc;
      out.push(entry);
    }
  }
  return out;
}
