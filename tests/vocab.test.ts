/**
 * 两套协议词表 —— 故意不合并：KIND_TO_PROTO 吃网关 schema 的 endpoint.kind（playground 用），
 * ENDPOINT_TO_PROTO 吃模型库 mdl_info.endpoints 的逗号串（模型详情页用）。两边命名不一致
 * 是历史事实，合并会让任一方改名时静默漏协议。所以各自有测试。
 */
import { describe, expect, it } from 'vitest';
import { ENDPOINT_TO_PROTO, KIND_TO_PROTO, protosFromEndpoints } from '../src/config/vocab.js';

describe('KIND_TO_PROTO（网关 schema 的 endpoint.kind）', () => {
  it('四协议映射齐全，responses 的单复数别名都在', () => {
    expect(KIND_TO_PROTO.openai_chat).toBe('chat');
    expect(KIND_TO_PROTO.anthropic_messages).toBe('messages');
    expect(KIND_TO_PROTO.openai_response).toBe('responses');
    expect(KIND_TO_PROTO.openai_responses).toBe('responses');
    expect(KIND_TO_PROTO.gemini_generate_content).toBe('gemini');
  });
});

describe('ENDPOINT_TO_PROTO（mdl_info.endpoints）', () => {
  it('四条映射按 DB 取值', () => {
    expect(ENDPOINT_TO_PROTO.chat_completions).toBe('chat');
    expect(ENDPOINT_TO_PROTO.claude_api).toBe('messages');
    expect(ENDPOINT_TO_PROTO.responses).toBe('responses');
    expect(ENDPOINT_TO_PROTO.gemini_api).toBe('gemini');
  });
});

describe('protosFromEndpoints', () => {
  it('解析逗号串，保持声明顺序', () => {
    // claude-opus-5 线上就是这一串
    expect(protosFromEndpoints('chat_completions,claude_api,responses'))
      .toEqual(['chat', 'messages', 'responses']);
  });

  it('容忍空格与数组形态', () => {
    expect(protosFromEndpoints(' chat_completions , gemini_api ')).toEqual(['chat', 'gemini']);
    expect(protosFromEndpoints(['claude_api', 'responses'])).toEqual(['messages', 'responses']);
  });

  it('去重', () => {
    expect(protosFromEndpoints('responses,responses,chat_completions')).toEqual(['responses', 'chat']);
  });

  it('无数据就降级：空 / null / 全是未知项 → []，绝不猜协议', () => {
    // 线上 kimi-k3 的 endpoints 就是空。猜出来的协议会生成一段跑不通的示例。
    expect(protosFromEndpoints('')).toEqual([]);
    expect(protosFromEndpoints(null)).toEqual([]);
    expect(protosFromEndpoints(undefined)).toEqual([]);
    expect(protosFromEndpoints('something_new,another')).toEqual([]);
  });

  it('已知项与未知项混排时只留已知的，不整条作废', () => {
    expect(protosFromEndpoints('chat_completions,brand_new_api')).toEqual(['chat']);
  });
});
