/**
 * 扩展性：「模型能力加一个参数」应当是零代码 —— schema 声明即生效。
 *
 * buildBody 有三条按类型认领新键的通用兜底通道（emitExtraNumbers / emitEnums / emitObjects），
 * 下面用一个**当前代码里根本不存在的新参数名**来验这条链路，而不是挑一个已被特判的老参数
 * （那样测的是特判，不是通用通道）。
 *
 * 本文件还钉住一个**现存缺口**，按当前真实行为写断言、注释里写清「修好之后期望值该改成
 * 什么」—— 目的是把静默行为变成显式基线，不是替它背书：go chat 会丢掉任何没在 goChat 里
 * 手工映射过的键，不只是 object 参数。
 * （曾经的另一个缺口「emitEnums 没有 inSchema 门控」已修，对应断言已翻面。）
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { generateCode } from '../src/generate.js';
import { buildBody } from '../src/wire/body.js';
import { GO_CHAT_KEYS, GO_OBJ_FIELDS } from '../src/renderers/go.js';
import { PARAM_KEYS, STRUCTURED, TOOLS, baseCtx, ctxWith } from './fixture.js';

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

  it('枚举参数同样受 schema 门控：未声明就不发', () => {
    // 三条通用通道现在一致都调 inSchema()。emitEnums 曾经漏了这一条，
    // 表现是「面板不显示、body 里却有」—— 破坏「面板显示什么 == 请求发什么 == 示例出什么」。
    const b = buildBody('chat', ctxWith({ enums: { [NEW_ENUM]: 'turbo' } }));
    expect(NEW_ENUM in b).toBe(false);
  });

  it('切协议后残留的枚举不会跟着进新协议的 body（这条门控真正要挡的场景）', () => {
    // 真实路径：playground 在 chat 下设了 service_tier，切到 messages。schema 换了、
    // paramKeys 换了，但 enums 这份状态还在。没有门控时它会跟着进 messages 的 body，
    // 网关按未知字段拒 —— 而用户在面板上根本看不到这个参数，无从排查。
    const chatOnlyEnum = 'service_tier';
    const inChat = ctxWith({ enums: { [chatOnlyEnum]: 'priority' } }); // fixture 的 PARAM_KEYS 含它
    expect(buildBody('chat', inChat)[chatOnlyEnum]).toBe('priority');

    // 切到 messages：schema 换成不含 service_tier 的那份，enums 里的残留值原样留着。
    const messagesKeys = PARAM_KEYS.filter((k) => k !== chatOnlyEnum);
    const switched = ctxWith({ paramKeys: messagesKeys, enums: { [chatOnlyEnum]: 'priority' } });
    const b = buildBody('messages', switched);
    expect(chatOnlyEnum in b).toBe(false);
    expect(JSON.stringify(b).includes('priority')).toBe(false);
  });

  it('省略 paramKeys 时不门控（向后兼容：老调用方没传就别把它的参数吃掉）', () => {
    const { paramKeys: _drop, ...noKeys } = ctxWith({ enums: { [NEW_ENUM]: 'turbo' } });
    expect(buildBody('chat', noKeys)[NEW_ENUM]).toBe('turbo');
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
  it('【结构性缺口，不可修】没有对应 struct 字段的键发不出去 —— 但必须在代码里点名', () => {
    // go-openai 的 ChatCompletionRequest 是封闭 struct：没有 map 兜底，也没有 ExtraBody
    // （已核对 v1.41.2 的定义）。所以任意新键在 go chat 结构上就是发不出去，这条**修不掉**，
    // 只能不瞒着。以前是静默消失（示例看着好好的、发出去少参数），现在渲染成一段注释点名。
    //
    // 注意断言的是「值没进请求体」而不是「字符串没出现」—— 键名会出现在那段注释里。
    const code = generateCode('chat', 'go', newParamCtx);
    for (const [label, key] of [['数值', NEW_NUM], ['枚举', NEW_ENUM], ['对象', NEW_OBJ]] as const) {
      expect(code, `${label}：该键该被点名`).toContain(key);
      // 点名只许出现在注释行里；出现在 struct 字面量里就是渲染出了编不过的字段。
      const nonComment = code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(nonComment, `${label}：不该出现在请求结构体里`).not.toContain(key);
    }
    expect(code).toContain('go-openai 的 ChatCompletionRequest 没有以下字段');
  });

  it('go-openai 真有对应字段的键，现在都渲染出来了（曾经也一起静默丢）', () => {
    // 这批以前和上面那些一样从 go chat 消失，但它们是**能修的** —— struct 里有同名字段。
    const code = generateCode('chat', 'go', ctxWith({
      tools: TOOLS,
      toolChoice: { mode: 'tool', name: 'get_weather' },
      structured: STRUCTURED,
      objects: { parallel_tool_calls: false },
      enums: { service_tier: 'priority', verbosity: 'low' },
      p: { ...baseCtx.p, n: 2, frequency_penalty: 0.5, presence_penalty: 0.3 },
      paramKeys: [...PARAM_KEYS, 'n', 'frequency_penalty', 'presence_penalty', 'tools',
        'tool_choice', 'response_format'],
    }));
    for (const field of ['FrequencyPenalty', 'PresencePenalty', 'N:', 'Verbosity', 'ServiceTier',
      'ParallelToolCalls', 'Tools:', 'ToolChoice', 'ResponseFormat']) {
      expect(code, field).toContain(field);
    }
    // 嵌套结构体真的展开了，不是只写了个字段名。
    expect(code).toContain('openai.FunctionDefinition{');
    expect(code).toContain('openai.ChatCompletionResponseFormatTypeJSONSchema');
    // schema JSON 塞在 Go raw string 里，需要 encoding/json —— import 得跟着加。
    expect(code).toContain('"encoding/json"');
  });

  it('不需要 json.RawMessage 时不多 import（Go 会因未使用的 import 编译失败）', () => {
    const code = generateCode('chat', 'go', baseCtx);
    expect(code).not.toContain('"encoding/json"');
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
