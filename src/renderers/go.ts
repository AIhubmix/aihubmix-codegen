/**
 * Go renderer：chat 走 go-openai（强类型 struct），其余协议走 net/http 原生 REST。
 *
 * GO_OBJ_FIELDS 是 go 专属类型映射（只在本文件用），按三档划分留在代码里，不进 config。
 *
 * ⚠️ **结构性限制，修不掉**：go-openai 的 ChatCompletionRequest 是封闭 struct —— 没有 map
 * 兜底字段，也没有 ExtraBody（已核对 v1.41.2 的定义）。所以 go chat 只能发出该 struct 里
 * 存在的字段，另 6 门语言的「body 里有什么就出什么」在这里不成立。
 *
 * 能做的两件事都做了：一是把 struct 真有的字段全接上（见 GO_CHAT_KEYS）；二是剩下发不出去
 * 的键**在生成的代码里点名**，而不是像以前那样静默消失 —— 示例看着好好的、发出去少参数，
 * 是最难查的一类。彻底解法是 go chat 也改走 net/http（像另外三个协议那样），代价是丢掉
 * SDK 惯用写法，那是产品取舍，不在这里替用户做。
 */
import type { CgMsg, CodeGenCtx, CodeProto } from '../types.js';
import { ENV_KEY_EXPR } from '../config/placeholders.js';
import { SDK } from '../config/sdk.js';
import { esc, goRawSafe, num } from '../emit/escape.js';
import { jsonLines } from '../emit/literal.js';
import { authHeaders, headerValueConcat } from '../wire/auth.js';
import { buildBody, inSchema, isEmptyContainer } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';
import { buildMessages } from '../wire/messages.js';
import { hasImages } from './shared.js';

/** Go 字面量序列化（结构化参数 → go-openai 强类型字段值）。
 *  Go 字符串字面量与 JSON 转义规则兼容（\n \t \" \\ \uXXXX），故字符串直接用 JSON.stringify。 */
function goLiteral(value: unknown, kind: 'map_int' | 'map_str' | 'slice_str'): string {
  const gs = (s: unknown) => JSON.stringify(String(s));
  if (kind === 'map_int') {
    const ents = Object.entries((value ?? {}) as Record<string, unknown>).map(
      ([k, v]) => `${gs(k)}: ${num(Number(v))}`,
    );
    return `map[string]int{${ents.join(', ')}}`;
  }
  if (kind === 'map_str') {
    const ents = Object.entries((value ?? {}) as Record<string, unknown>).map(
      ([k, v]) => `${gs(k)}: ${gs(v)}`,
    );
    return `map[string]string{${ents.join(', ')}}`;
  }
  // slice_str：数组逐项；单值兜底成单元素切片。
  const arr = Array.isArray(value) ? value : [value];
  return `[]string{${arr.map((v) => gs(v)).join(', ')}}`;
}

/**
 * go-openai ChatCompletionRequest 的强类型结构化字段（值来自 ctx.objects）。
 *
 * 导出仅供 tests/extensibility.test.ts 用：那条测试拿 buildBody 的实际产物比对本表，
 * 新增的 object/array 参数没映射就红，把「go chat 静默丢字段」变成显式失败。
 * 不进 src/index.ts 的公共出口 —— 这是 go renderer 的内部细节，不是包的对外契约。
 */
export const GO_OBJ_FIELDS: { key: string; field: string; kind: 'map_int' | 'map_str' | 'slice_str' }[] = [
  { key: 'logit_bias', field: 'LogitBias', kind: 'map_int' },
  { key: 'stop', field: 'Stop', kind: 'slice_str' },
  { key: 'metadata', field: 'Metadata', kind: 'map_str' },
];

/**
 * goChat 能渲染的**全部** body 键。
 *
 * 另外 6 门语言是「body 里有什么就出什么」（原生 REST 直接 jsonLines(buildBody)，
 * SDK 语言逐键渲染），只有 go chat 例外：go-openai 的 ChatCompletionRequest 是强类型
 * struct，没有 map 兜底，所以每个键都得在本文件手工映射一次。
 *
 * 不在本表里的键会走 droppedNote 那条路 —— 渲染成一段注释点名，不静默丢。加新参数时
 * **先查 go-openai 有没有同名字段**：有就在 goChat 里补一段渲染并把键加进本表（那才是发得
 * 出去的）；没有就什么都不用做，注释会自动带上它。
 *
 * tests/extensibility.test.ts 的覆盖测试盯着这条：buildBody 产出的非结构性键只要不在本表里，
 * 就必须出现在注释里而**不能**出现在请求结构体里。
 * 与 GO_OBJ_FIELDS 一样，导出仅供测试，不进 src/index.ts 的对外契约。
 */
export const GO_CHAT_KEYS: readonly string[] = [
  'model',
  'messages',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'n',
  'verbosity',
  'service_tier',
  'reasoning_effort',
  'seed',
  'top_logprobs',
  'logprobs',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'response_format',
  'prediction', // 嵌套 typed struct，只渲染成一行提示注释，不展开
  'stream', // goChat 是非流式骨架，body 里的 stream:false 不需要落到 struct
  ...GO_OBJ_FIELDS.map((f) => f.key),
];

/**
 * go-openai 的 `ReasoningValidator`（`reasoning_validator.go`，已对 v1.41.2 逐行核过）在
 * **客户端**就拦掉的一组参数 —— 命中时 `CreateChatCompletion` 在发请求之前直接返回 error，
 * 示例连一次网络调用都没有，用户看到的是一段 panic。
 *
 * 判据是**模型 id 前缀**，与网关无关：同一份 body 用 curl 发过去网关照收（线上实测 200）。
 * 所以这是「go-openai 这个 SDK 的限制」，不是协议事实，只影响 go × chat 这一格 ——
 * 另外三个协议的 Go 示例走 net/http，不受影响。
 *
 * 上游那条规则原样镜像如下（改这里之前先对一遍上游文件，它是唯一真源）：
 * 模型 id 以 `o1` / `o3` / `o4` / `gpt-5` 开头时——
 *   - `MaxTokens > 0` → 报错，要求改用 `MaxCompletionTokens`
 *   - `LogProbs` 为 true → 报错
 *   - `Temperature` / `TopP` / `N` 只允许 1（或不设）
 *   - `PresencePenalty` / `FrequencyPenalty` 只允许 0（或不设）
 */
const GO_REASONING_PREFIXES = ['o1', 'o3', 'o4', 'gpt-5'] as const;

/** 模型 id 会不会命中 go-openai 的 reasoning 客户端校验。 */
export function goReasoningModel(id: string): boolean {
  return GO_REASONING_PREFIXES.some((pfx) => id.startsWith(pfx));
}

/** 数值键 → go-openai 的 float32/int 字段。发不发由「schema 声明 + 值存在」决定，值原样透传。 */
const GO_NUM_FIELDS: { key: string; field: string }[] = [
  { key: 'frequency_penalty', field: 'FrequencyPenalty' },
  { key: 'presence_penalty', field: 'PresencePenalty' },
  { key: 'n', field: 'N' },
];

/** 字符串/枚举键 → go-openai 的具名字符串类型字段（ServiceTier 是 defined type，字面量可直接赋）。 */
const GO_STR_FIELDS: { key: string; field: string }[] = [
  { key: 'verbosity', field: 'Verbosity' },
  { key: 'service_tier', field: 'ServiceTier' },
];

/** go-openai ChatCompletionMessage 列表：复用 buildMessages（chat）→ 完整多轮历史。
 *  go-openai 图片需 MultiContent，本示例沿用纯文本降级（提取 text 块），与既有 goChat 行为一致。 */
function goMessages(ctx: CodeGenCtx): string {
  const src: CgMsg[] =
    ctx.messages && ctx.messages.length
      ? ctx.messages
      : [{ role: 'user', content: ctx.user, ...(hasImages(ctx) ? { images: ctx.images } : {}) }];
  const arr = buildMessages('chat', src, ctx.sys, { cache: ctx.cache, truncate: true }) as Array<
    Record<string, unknown>
  >;
  const roleConst = (r: string) =>
    r === 'system'
      ? 'openai.ChatMessageRoleSystem'
      : r === 'assistant'
        ? 'openai.ChatMessageRoleAssistant'
        : r === 'tool'
          ? 'openai.ChatMessageRoleTool'
          : 'openai.ChatMessageRoleUser';
  const textOf = (content: unknown): string => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content))
      return content
        .filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text')
        .map((b) => String((b as Record<string, unknown>).text ?? ''))
        .join('\n');
    return '';
  };
  return arr
    .map((m) => `\n\t\t\t{Role: ${roleConst(String(m.role))}, Content: "${esc(textOf(m.content))}"},`)
    .join('');
}

export function goChat(ctx: CodeGenCtx): string {
  const { model, p } = ctx;
  const d = SDK.go?.chat;
  if (!d) throw new Error('config/sdk.ts 缺 go × chat 记录');
  const msgs = goMessages(ctx);

  // go-openai 的 ReasoningValidator 会不会拦这次请求。命中时下面几个字段必须让路，
  // 否则 CreateChatCompletion 在**发请求之前**就返回 error，示例一行输出都没有。
  const isReasoning = goReasoningModel(model.id);
  /** 因为上面那条客户端校验而没能渲染出来的 body 键，最后并进 droppedNote 一起点名。 */
  const blockedByValidator: string[] = [];
  /** 命中 reasoning 校验时挡下这个键并记账；返回「是否放行」。 */
  const allowUnlessReasoning = (key: string): boolean => {
    if (!isReasoning) return true;
    blockedByValidator.push(key);
    return false;
  };

  // MaxTokens vs MaxCompletionTokens：判据是 go-openai 自己那条模型 id 前缀规则，不是
  // schema 声明了哪个键。以前只看 ctx.paramKeys.includes('max_completion_tokens')——那要求
  // 调用方的 schema 恰好声明了它，gpt-5 系模型在 schema 没声明时就会渲染出 MaxTokens 然后
  // 当场 panic（线上实测复现过）。这里两个触发条件取并集：模型 id 命中，或 schema 明说要它。
  const useMaxCompletion = isReasoning || !!ctx.paramKeys?.includes('max_completion_tokens');
  const maxField = useMaxCompletion
    ? `\n\t\t\tMaxCompletionTokens: ${p.max_tokens},`
    : `\n\t\t\tMaxTokens: ${p.max_tokens},`;
  // temperature/top_p 仅在 schema 声明且非默认(1)时发 —— 多数模型互斥/锁定，默认值会被拒。
  // 非 1 的取值正是 ReasoningValidator 要拦的那种，所以 reasoning 模型下整条让路。
  const tempField =
    inSchema(ctx, 'temperature') && +(p.temperature ?? 1) !== 1 && allowUnlessReasoning('temperature')
      ? `\n\t\t\tTemperature: ${num(p.temperature ?? 1)},` : '';
  const toppField =
    inSchema(ctx, 'top_p') && +(p.top_p ?? 1) !== 1 && allowUnlessReasoning('top_p')
      ? `\n\t\t\tTopP: ${num(p.top_p ?? 1)},` : '';
  const reasoningField = ctx.think ? `\n\t\t\tReasoningEffort: "${ctx.thinkLevel}",` : '';

  // 结构化字段（logit_bias/stop/metadata）→ go-openai 强类型字段；空容器/未声明跳过。
  const objs = ctx.objects ?? {};
  let objFields = '';
  for (const m of GO_OBJ_FIELDS) {
    const v = objs[m.key];
    if (v == null || isEmptyContainer(v) || !inSchema(ctx, m.key)) continue;
    objFields += `\n\t\t\t${m.field}: ${goLiteral(v, m.kind)},`;
  }
  // prediction 是嵌套 typed struct（*Prediction），本示例不展开，提示用 raw JSON。
  const predV = objs.prediction;
  if (predV != null && !isEmptyContainer(predV) && inSchema(ctx, 'prediction')) {
    objFields += `\n\t\t\t// prediction: set via raw JSON`;
  }

  // 直通的标量字段：go-openai 有同名强类型字段，值原样透传。发不发只看 buildBody 发没发
  // ——以 body 为准而不是以 ctx 为准，能力门控/schema 门控都已经在那一层判完了。
  const bodyChat = buildBody('chat', ctx);
  let scalarFields = '';
  for (const m of GO_NUM_FIELDS) {
    const v = bodyChat[m.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // n / presence_penalty / frequency_penalty 三个都在 ReasoningValidator 的拦截名单里
    // （n 只许 1，两个 penalty 只许 0）。buildBody 已经滤掉了等于默认值的取值，所以能走到
    // 这里的必然是会被拦的那种 —— 直接让路并记账，别渲染出一段发不出去的代码。
    if (!allowUnlessReasoning(m.key)) continue;
    scalarFields += `\n\t\t\t${m.field}: ${num(v)},`;
  }
  for (const m of GO_STR_FIELDS) {
    const v = bodyChat[m.key];
    if (typeof v !== 'string' || !v) continue;
    scalarFields += `\n\t\t\t${m.field}: "${esc(v)}",`;
  }
  // ParallelToolCalls 声明成 any：go-openai 用它区分「没设」与「显式 false」，不能省。
  if (typeof bodyChat.parallel_tool_calls === 'boolean') {
    scalarFields += `\n\t\t\tParallelToolCalls: ${bodyChat.parallel_tool_calls},`;
  }

  // tools / response_format：go-openai 是嵌套 typed struct，schema 那一层用 json.RawMessage
  // 塞原始 JSON（FunctionDefinition.Parameters 是 any，ResponseFormat 的 Schema 是
  // json.Marshaler，RawMessage 两者都满足）—— 不用再造一遍 jsonschema 结构体。
  let needsJSON = false;
  let toolsField = '';
  const toolsArr = bodyChat.tools;
  if (Array.isArray(toolsArr) && toolsArr.length) {
    const items = toolsArr
      .map((t) => {
        const fn = (t as Record<string, unknown>).function as Record<string, unknown> | undefined;
        if (!fn) return '';
        const params = fn.parameters == null ? '' :
          `\n\t\t\t\t\t\tParameters: json.RawMessage(\`${goRawSafe(JSON.stringify(fn.parameters))}\`),`;
        const desc = fn.description ? `\n\t\t\t\t\t\tDescription: "${esc(String(fn.description))}",` : '';
        return `\n\t\t\t\t{\n\t\t\t\t\tType: openai.ToolTypeFunction,\n\t\t\t\t\tFunction: &openai.FunctionDefinition{\n\t\t\t\t\t\tName: "${esc(String(fn.name ?? ''))}",${desc}${params}\n\t\t\t\t\t},\n\t\t\t\t},`;
      })
      .join('');
    if (items) {
      needsJSON = items.includes('json.RawMessage');
      toolsField = `\n\t\t\tTools: []openai.Tool{${items}\n\t\t\t},`;
    }
  }
  let rfField = '';
  const rf = bodyChat.response_format as Record<string, unknown> | undefined;
  if (rf && typeof rf === 'object' && !Array.isArray(rf)) {
    const js = rf.json_schema as Record<string, unknown> | undefined;
    if (js) {
      needsJSON = true;
      const strict = js.strict ? '\n\t\t\t\t\tStrict: true,' : '';
      rfField =
        `\n\t\t\tResponseFormat: &openai.ChatCompletionResponseFormat{` +
        `\n\t\t\t\tType: openai.ChatCompletionResponseFormatTypeJSONSchema,` +
        `\n\t\t\t\tJSONSchema: &openai.ChatCompletionResponseFormatJSONSchema{` +
        `\n\t\t\t\t\tName: "${esc(String(js.name ?? 'response'))}",` +
        `\n\t\t\t\t\tSchema: json.RawMessage(\`${goRawSafe(JSON.stringify(js.schema ?? {}))}\`),` +
        `${strict}\n\t\t\t\t},\n\t\t\t},`;
    } else if (rf.type) {
      rfField =
        `\n\t\t\tResponseFormat: &openai.ChatCompletionResponseFormat{` +
        `\n\t\t\t\tType: openai.ChatCompletionResponseFormatType("${esc(String(rf.type))}"),\n\t\t\t},`;
    }
  }

  // tool_choice：go-openai 这个字段的类型是 `any`（注释里写明「string 或 ToolChoice 对象」）。
  // 直接塞 json.RawMessage 原样透传 —— 一条分支同时覆盖 "required" 这种字符串形态和
  // {type:"function",function:{name}} 这种对象形态，上游哪天再加一种形状也不用改这里。
  let tcField = '';
  const tc = bodyChat.tool_choice;
  if (tc !== undefined) {
    needsJSON = true;
    tcField = `\n\t\t\tToolChoice: json.RawMessage(\`${goRawSafe(JSON.stringify(tc))}\`),`;
  }

  // seed（*int）：go-openai 取指针，故在请求前声明局部变量再取址。
  const seed = p.seed;
  const hasSeed = inSchema(ctx, 'seed') && seed != null;
  const seedDecl = hasSeed ? `\n\tseed := ${num(seed as number)}\n` : '';
  const seedField = hasSeed ? `\n\t\t\tSeed: &seed,` : '';
  // top_logprobs（int）：需同时置 LogProbs: true 才会返回 logprobs。
  // 这一对必须一起发，而 LogProbs: true 是 ReasoningValidator 明确拦的一条，所以整对让路。
  const tlp = p.top_logprobs;
  const logprobsField =
    inSchema(ctx, 'top_logprobs') && tlp != null && allowUnlessReasoning('top_logprobs')
      ? `\n\t\t\tLogProbs: true,\n\t\t\tTopLogProbs: ${num(tlp)},`
      : '';

  // 两类发不出去的键，合成一段注释一起点名（必须放在所有字段都算完之后，
  // blockedByValidator 是一路累积上来的）。它们的原因不同，所以分两行说，别混成一句：
  //   · struct 里根本没这个字段 —— 换 net/http 才发得出去
  //   · struct 有字段，但 go-openai 的客户端校验不让这个模型带它 —— 换个模型才发得出去
  const knownGo = new Set(GO_CHAT_KEYS);
  const dropped = Object.keys(bodyChat).filter((k) => !knownGo.has(k));
  const droppedNote =
    (dropped.length
      ? `\n\t// 注意：go-openai 的 ChatCompletionRequest 没有以下字段，本示例发不出去：\n` +
        `\t//   ${dropped.join(', ')}\n` +
        `\t// 需要它们的话改用 net/http 直接发 JSON（本页其余三个协议的 Go 示例就是那种写法）。\n`
      : '') +
    (blockedByValidator.length
      ? `\n\t// 注意：go-openai 对 o1/o3/o4/gpt-5 系模型有一层客户端校验（reasoning_validator.go），\n` +
        `\t// 带上以下参数会让请求在**发出之前**就返回 error，所以本示例没有渲染它们：\n` +
        `\t//   ${blockedByValidator.join(', ')}\n` +
        `\t// 网关本身是收这些参数的（同一份 body 用 curl 发得通），这是该 SDK 的限制。\n`
      : '');

  // "os" 固定进 import：key 走 os.Getenv，不出字面量
  const stdImports = needsJSON ? '\t"context"\n\t"encoding/json"\n\t"fmt"\n\t"os"' : '\t"context"\n\t"fmt"\n\t"os"';

  return `package main

import (
${stdImports}

\t${d.imports.join('\n\t')}
)

func main() {
\tcfg := ${d.clientCtor}(${ENV_KEY_EXPR.go})
\tcfg.BaseURL = "${ctx.baseUrl}${d.baseSuffix}"
\t${d.clientVar} := openai.NewClientWithConfig(cfg)
${droppedNote}${seedDecl}
\t${d.resultVar}, err := ${d.call}(
\t\tcontext.Background(),
\t\topenai.ChatCompletionRequest{
\t\t\tModel: "${model.id}",
\t\t\tMessages: []openai.ChatCompletionMessage{${msgs}
\t\t\t},${maxField}${tempField}${toppField}${scalarFields}${reasoningField}${toolsField}${tcField}${rfField}${objFields}${seedField}${logprobsField}
\t\t},
\t)
\tif err != nil {
\t\tpanic(err)
\t}
\t${d.read}
}`;
}

export function goRaw(proto: CodeProto, ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody(proto, ctx), '\t\t');
  const headers = authHeaders(proto)
    .map((h) => `\treq.Header.Set("${h.name}", ${headerValueConcat(h.value, ENV_KEY_EXPR.go)})`)
    .join('\n');
  return `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"net/http"
\t"os"
)

func main() {
\tpayload := []byte(\`
${goRawSafe(body)}
\t\`)
\treq, _ := http.NewRequest("POST", "${ctx.baseUrl}${endpointPath(proto, ctx)}", bytes.NewBuffer(payload))
\treq.Header.Set("Content-Type", "application/json")
${headers}

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()
\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))
}`;
}
