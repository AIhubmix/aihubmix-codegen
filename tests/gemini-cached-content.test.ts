/**
 * gemini 顶层字段回提 —— 参数面板把 gemini 采样扁平化后,emitEnums 会把所有字符串参数
 * 写进 generationConfig;但 cachedContent(显式缓存资源名引用)在 GenerateContentRequest
 * 里是顶层字段,嵌进 generationConfig 上游会忽略(静默失效)。锁住提升逻辑。
 */
import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/wire/body.js';
import { ctxWith } from './fixture.js';

describe('gemini cachedContent 顶层提升', () => {
  it('设置 cachedContent 时出现在顶层,不在 generationConfig', () => {
    const b = buildBody(
      'gemini',
      ctxWith({
        paramKeys: ['temperature', 'cachedContent'],
        enums: { cachedContent: 'cachedContents/abc123' },
      }),
    ) as Record<string, unknown>;
    expect(b.cachedContent).toBe('cachedContents/abc123');
    const gc = (b.generationConfig ?? {}) as Record<string, unknown>;
    expect(gc.cachedContent).toBeUndefined();
  });

  it('未设置时顶层不出现该键', () => {
    const b = buildBody('gemini', ctxWith({ paramKeys: ['temperature'] })) as Record<string, unknown>;
    expect('cachedContent' in b).toBe(false);
  });

  it('空串不发(emitEnums 空值跳过语义不变)', () => {
    const b = buildBody(
      'gemini',
      ctxWith({ paramKeys: ['cachedContent'], enums: { cachedContent: '' } }),
    ) as Record<string, unknown>;
    expect('cachedContent' in b).toBe(false);
  });
});
