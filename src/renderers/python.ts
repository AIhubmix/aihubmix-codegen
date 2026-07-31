/**
 * Python renderer：chat / messages / responses 走各自官方 SDK，gemini 走 google-genai。
 *
 * 「用哪个客户端 / 调哪个方法 / 怎么取响应」全部来自 config/sdk.ts，本文件只负责
 * 「python 怎么把它写成一行」。骨架留在代码里（见三档划分的反向边界）。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { ENV_KEY_EXPR } from '../config/placeholders.js';
import { SDK, type SdkDef } from '../config/sdk.js';
import { esc } from '../emit/escape.js';
import { pyLiteral, sdkParamLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { geminiSdkCall } from './gemini-sdk.js';
import { imageNote, messagesLiteral } from './shared.js';

/** 取 SDK 记录；本文件四个协议都必有记录，缺失即配置表被改坏。 */
function def(proto: CodeProto): SdkDef {
  const d = SDK.python?.[proto];
  if (!d) throw new Error(`config/sdk.ts 缺 python × ${proto} 记录`);
  return d;
}

/** OpenAI / Anthropic 风格的 python 客户端构造（同为 api_key + base_url 关键字参数）。
 *  key 从环境变量取（os.environ），所以骨架里固定多一行 `import os`。 */
function pyClient(d: SdkDef, baseUrl: string): string {
  return `import os
${d.imports.join('\n')}

${d.clientVar} = ${d.clientCtor}(
    api_key=${ENV_KEY_EXPR.python},
    base_url="${baseUrl}${d.baseSuffix}",
)`;
}

/** 调用之后的取值段：流式与非流式各自一段，统一带前导空行。 */
function pyTail(d: SdkDef, stream: boolean | undefined): string {
  return `\n${stream ? d.readStream : d.read}`;
}

export function pyChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const d = def('chat');
  const params = sdkParamLines(buildBody('chat', ctx), 'python', 'chat', '    ');
  return `${imageNote(ctx, 'python', 'chat')}${pyClient(d, ctx.baseUrl)}

${d.resultVar} = ${d.call}(
    model="${model.id}",
    messages=${messagesLiteral('chat', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${pyTail(d, stream)}`;
}

export function pyMessages(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const d = def('messages');
  const params = sdkParamLines(buildBody('messages', ctx), 'python', 'messages', '    ');
  // Anthropic：system 是独立字段（cache 时打 cache_control 断点）；messages 数组不含 system。
  const systemPy = sys
    ? ctx.cache
      ? `\n    system=${pyLiteral([{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], '    ')},`
      : `\n    system="${esc(sys)}",`
    : '';
  return `${imageNote(ctx, 'python', 'messages')}${pyClient(d, ctx.baseUrl)}

${d.resultVar} = ${d.call}(
    model="${model.id}",${systemPy}
    messages=${messagesLiteral('messages', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${pyTail(d, stream)}`;
}

export function pyResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const d = def('responses');
  const params = sdkParamLines(buildBody('responses', ctx), 'python', 'responses', '    ');
  return `${imageNote(ctx, 'python', 'responses')}${pyClient(d, ctx.baseUrl)}

${d.resultVar} = ${d.call}(
    model="${model.id}",${sys ? `\n    instructions="${esc(sys)}",` : ''}
    input=${messagesLiteral('responses', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${pyTail(d, stream)}`;
}

export function pyGemini(ctx: CodeGenCtx): string {
  const d = def('gemini');
  const { contents, config } = geminiSdkCall(buildBody('gemini', ctx), true);
  const cfgLine = Object.keys(config).length ? `\n    config=${pyLiteral(config, '    ')},` : '';
  // google-genai 的 base URL 走 http_options 字典，构造形状与 OpenAI/Anthropic 不同，故不复用 pyClient。
  return `${imageNote(ctx, 'python', 'gemini')}import os
${d.imports.join('\n')}

${d.clientVar} = ${d.clientCtor}(
    api_key=${ENV_KEY_EXPR.python},
    http_options={"base_url": "${ctx.baseUrl}${d.baseSuffix}"},
)

${d.resultVar} = ${d.call}(
    model="${ctx.model.id}",
    contents=${pyLiteral(contents, '    ')},${cfgLine}
)
${d.read}`;
}
