/**
 * Go renderer：chat 走 go-openai（强类型 struct），其余协议走 net/http 原生 REST。
 *
 * GO_OBJ_FIELDS 是 go 专属类型映射（只在本文件用），按三档划分留在代码里，不进 config。
 * ⚠️ 已知缺口：不在该表里的 object/array 参数在 go chat 单元格会静默丢失（另 6 语言正常）。
 */
import type { CgMsg, CodeGenCtx, CodeProto } from '../types.js';
import { API_KEY_PLACEHOLDER, BASE } from '../config/placeholders.js';
import { SDK } from '../config/sdk.js';
import { esc, goRawSafe, num } from '../emit/escape.js';
import { jsonLines } from '../emit/literal.js';
import { authHeaders } from '../wire/auth.js';
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

/** go-openai ChatCompletionRequest 的强类型结构化字段（值来自 ctx.objects）。 */
const GO_OBJ_FIELDS: { key: string; field: string; kind: 'map_int' | 'map_str' | 'slice_str' }[] = [
  { key: 'logit_bias', field: 'LogitBias', kind: 'map_int' },
  { key: 'stop', field: 'Stop', kind: 'slice_str' },
  { key: 'metadata', field: 'Metadata', kind: 'map_str' },
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
  // go-openai 对 o1/gpt-5 等新模型客户端侧拒绝 MaxTokens，要求 MaxCompletionTokens；按 schema 是否声明切换。
  const maxField = ctx.paramKeys?.includes('max_completion_tokens')
    ? `\n\t\t\tMaxCompletionTokens: ${p.max_tokens},`
    : `\n\t\t\tMaxTokens: ${p.max_tokens},`;
  // temperature/top_p 仅在 schema 声明且非默认(1)时发 —— 多数模型互斥/锁定，默认值会被拒。
  const tempField =
    inSchema(ctx, 'temperature') && +(p.temperature ?? 1) !== 1 ? `\n\t\t\tTemperature: ${num(p.temperature ?? 1)},` : '';
  const toppField = inSchema(ctx, 'top_p') && +(p.top_p ?? 1) !== 1 ? `\n\t\t\tTopP: ${num(p.top_p ?? 1)},` : '';
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

  // seed（*int）：go-openai 取指针，故在请求前声明局部变量再取址。
  const seed = p.seed;
  const hasSeed = inSchema(ctx, 'seed') && seed != null;
  const seedDecl = hasSeed ? `\n\tseed := ${num(seed as number)}\n` : '';
  const seedField = hasSeed ? `\n\t\t\tSeed: &seed,` : '';
  // top_logprobs（int）：需同时置 LogProbs: true 才会返回 logprobs。
  const tlp = p.top_logprobs;
  const logprobsField =
    inSchema(ctx, 'top_logprobs') && tlp != null
      ? `\n\t\t\tLogProbs: true,\n\t\t\tTopLogProbs: ${num(tlp)},`
      : '';

  return `package main

import (
\t"context"
\t"fmt"

\t${d.imports.join('\n\t')}
)

func main() {
\tcfg := ${d.clientCtor}("${API_KEY_PLACEHOLDER}")
\tcfg.BaseURL = "${BASE}${d.baseSuffix}"
\t${d.clientVar} := openai.NewClientWithConfig(cfg)
${seedDecl}
\t${d.resultVar}, err := ${d.call}(
\t\tcontext.Background(),
\t\topenai.ChatCompletionRequest{
\t\t\tModel: "${model.id}",
\t\t\tMessages: []openai.ChatCompletionMessage{${msgs}
\t\t\t},${maxField}${tempField}${toppField}${reasoningField}${objFields}${seedField}${logprobsField}
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
    .map((h) => `\treq.Header.Set("${h.name}", "${h.value}")`)
    .join('\n');
  return `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"net/http"
)

func main() {
\tpayload := []byte(\`
${goRawSafe(body)}
\t\`)
\treq, _ := http.NewRequest("POST", "${BASE}${endpointPath(proto, ctx)}", bytes.NewBuffer(payload))
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
