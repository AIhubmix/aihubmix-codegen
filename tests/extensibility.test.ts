/**
 * 扩展性：「模型能力加一个参数」应当是零代码 —— schema 声明即生效。
 *
 * buildBody 有三条按类型认领新键的通用兜底通道（emitExtraNumbers / emitEnums / emitObjects），
 * 下面用一个**当前代码里根本不存在的新参数名**来验这条链路，而不是挑一个已被特判的老参数
 * （那样测的是特判，不是通用通道）。
 *
 * 本文件同时钉住两个跑测试时才发现的**现存缺口**，两条都按当前真实行为写断言、注释里写清
 * 「修好之后期望值该改成什么」—— 目的是把静默行为变成显式基线，不是替它背书：
 *   ① emitEnums 没有 inSchema 门控（另两条通道有）；
 *   ② go chat 会丢掉任何没在 goChat 里手工映射过的键，不只是 object 参数。
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { generateCode } from '../src/generate.js';
import { buildBody } from '../src/wire/body.js';
import { GO_CHAT_KEYS, GO_OBJ_FIELDS } from '../src/renderers/go.js';
import { PARAM_KEYS, baseCtx, ctxWith } from './fixture.js';

// 三个新参数：数值 / 枚举 / 结构化，各走一条兜底通道。名字取当前代码里搜不到的。
const NEW_NUM = 'brand_new_knob';
const NEW_ENUM = 'brand_new_mode';
const NEW_OBJ = 'brand_new_shape';

const newParamCtx = ctxWith({
  paramKeys: [...PARAM_KEYS, NEW_NUM, NEW_ENUM, NEW_OBJ],
  p: { ...baseCtx.p, [NEW_NUM]: 42 },
  enums: { [NEW_ENUM]: 'turbo' },
  objects: { [NEW_OBJ]: { depth: 3 } },
});

describe('加参数：schema 声明即进 body', () => {
  it('数值 / 枚举 / 对象三类新参数都被 buildBody 认领', () => {
    for (const proto of ['chat', 'messages', 'responses'] as const) {
      const b = buildBody(proto, newParamCtx);
      expect(b[NEW_NUM], `${proto} 数值`).toBe(42);
      expect(b[NEW_ENUM], `${proto} 枚举`).toBe('turbo');
      expect(b[NEW_OBJ], `${proto} 对象`).toEqual({ depth: 3 });
    }
    // gemini 的采样参数嵌在 generationConfig 里
    const gc = buildBody('gemini', newParamCtx).generationConfig as Record<string, unknown>;
    expect(gc[NEW_NUM]).toBe(42);
    expect(gc[NEW_ENUM]).toBe('turbo');
  });

  it('数值与对象参数：schema 没声明就不发（面板不显示的参数不许偷偷进 body）', () => {
    const b = buildBody('chat', ctxWith({
      p: { ...baseCtx.p, [NEW_NUM]: 42 },
      objects: { [NEW_OBJ]: { depth: 3 } },
    }));
    expect(NEW_NUM in b).toBe(false);
    expect(NEW_OBJ in b).toBe(false);
  });

  it('【已知缺口】枚举参数没有 schema 门控：未声明也会发出去', () => {
    // emitExtraNumbers / emitObjects 都调 inSchema()，emitEnums 没调 —— 只判「非空且 ≠ 默认」。
    // 实际影响：playground 切协议时 enums 状态若跨协议留存，chat 专有的枚举（如 service_tier）
    // 会跟着进 messages 的 body，被网关拒。修法是给 emitEnums 补一行 inSchema 门控，
    // 但那是行为变更，要单独一个提交 + 基线快照零差异验证，不混在测试提交里。
    // 修好之后把下面这条改成 toBe(false)，并删掉本条测试标题里的「已知缺口」。
    const b = buildBody('chat', ctxWith({ enums: { [NEW_ENUM]: 'turbo' } }));
    expect(NEW_ENUM in b).toBe(true);
  });

  it('新参数出现在各语言产物里（go 的强类型缺口另见下一组）', () => {
    for (const lang of LANGS) {
      if (lang.id === 'go') continue; // go chat 是强类型 struct，见下一组测试
      const code = generateCode('chat', lang.id, newParamCtx);
      // SDK 语言允许落进 extra_body（PY_OPENAI_NATIVE 白名单外的键），仍算出得来。
      expect(code, `${lang.id} 数值`).toContain(NEW_NUM);
      expect(code, `${lang.id} 枚举`).toContain(NEW_ENUM);
      expect(code, `${lang.id} 对象`).toContain(NEW_OBJ);
    }
  });

  it('go 的非 chat 协议不受影响（goRaw 直接铺 buildBody，body 里有什么就出什么）', () => {
    for (const proto of ['messages', 'responses'] as const) {
      const code = generateCode(proto, 'go', newParamCtx);
      expect(code, `${proto} 数值`).toContain(NEW_NUM);
      expect(code, `${proto} 枚举`).toContain(NEW_ENUM);
      expect(code, `${proto} 对象`).toContain(NEW_OBJ);
    }
  });
});

describe('go chat 的强类型缺口：只许显式失败，不许静默丢', () => {
  it('【已知缺口】任何没手工映射过的新参数都会从 go chat 消失（数值也不例外）', () => {
    // 计划里原本以为只有 object/array 参数丢；实测数值、枚举一样丢 —— go-openai 的
    // ChatCompletionRequest 没有 map 兜底字段，goChat 只渲染 GO_CHAT_KEYS 里列过的键。
    // 修好（给 goChat 补渲染）之后把这三条改成 toContain。
    const code = generateCode('chat', 'go', newParamCtx);
    expect(code, '数值').not.toContain(NEW_NUM);
    expect(code, '枚举').not.toContain(NEW_ENUM);
    expect(code, '对象').not.toContain(NEW_OBJ);
  });

  it('buildBody 产出的每个键，goChat 都要认识（加参数忘了管 go 就红）', () => {
    // 用不含合成参数的正常 ctx：这条是**防回归门**，今天必须绿。
    // 往 fixture / schema 里加参数而没在 goChat 补渲染时，它会红并指名道姓。
    const b = buildBody('chat', ctxWith({
      objects: { stop: ['END'], logit_bias: { 1234: -100 }, metadata: { thread: 'a' } },
      p: { ...baseCtx.p, seed: 7, top_logprobs: 3 },
    }));
    const known = new Set(GO_CHAT_KEYS);
    const unknown = Object.keys(b).filter((k) => !known.has(k));
    expect(
      unknown,
      `这些键在 go chat 会被静默丢掉；要么在 renderers/go.ts 的 goChat 里补渲染并加进 ` +
      `GO_CHAT_KEYS，要么确认它不该出现在 chat body 里：${unknown.join(', ')}`,
    ).toEqual([]);
  });

  it('GO_CHAT_KEYS 覆盖 GO_OBJ_FIELDS，且已映射的 object 参数确实渲染进 go chat', () => {
    for (const f of GO_OBJ_FIELDS) expect(GO_CHAT_KEYS, f.key).toContain(f.key);
    const ctx = ctxWith({ objects: { stop: ['END'], logit_bias: { 1234: -100 }, metadata: { thread: 'a' } } });
    const code = generateCode('chat', 'go', ctx);
    for (const f of GO_OBJ_FIELDS) expect(code, f.key).toContain(f.field);
  });
});
