/**
 * TypeScript / JavaScript renderer：chat / messages / responses 走各自官方 SDK，gemini 走 @google/genai。
 *
 * SDK 事实（包名 / 客户端 / 调用 / 取值）全部来自 config/sdk.ts，本文件只管 js 的写法。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { API_KEY_PLACEHOLDER } from '../config/placeholders.js';
import { SDK, type SdkDef } from '../config/sdk.js';
import { esc } from '../emit/escape.js';
import { jsLiteral, sdkParamLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { geminiSdkCall } from './gemini-sdk.js';
import { imageNote, messagesLiteral } from './shared.js';

function def(proto: CodeProto): SdkDef {
  const d = SDK.javascript?.[proto];
  if (!d) throw new Error(`config/sdk.ts 缺 javascript × ${proto} 记录`);
  return d;
}

/** OpenAI / Anthropic 风格的 js 客户端构造（同为 apiKey + baseURL 选项）。 */
function tsClient(d: SdkDef, baseUrl: string): string {
  return `${d.imports.join('\n')}

const ${d.clientVar} = ${d.clientCtor}({
  apiKey: process.env.${API_KEY_PLACEHOLDER},
  baseURL: "${baseUrl}${d.baseSuffix}",
});`;
}

function tsTail(d: SdkDef, stream: boolean | undefined): string {
  return `\n${stream ? d.readStream : d.read}`;
}

export function tsChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const d = def('chat');
  const params = sdkParamLines(buildBody('chat', ctx), 'js', 'chat', '  ');
  return `${imageNote(ctx, 'js', 'chat')}${tsClient(d, ctx.baseUrl)}

const ${d.resultVar} = await ${d.call}({
  model: "${model.id}",
  messages: ${messagesLiteral('chat', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${tsTail(d, stream)}`;
}

export function tsMessages(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const d = def('messages');
  const params = sdkParamLines(buildBody('messages', ctx), 'js', 'messages', '  ');
  // Anthropic：system 是独立字段（cache 时打 cache_control 断点）；messages 数组不含 system。
  const systemTs = sys
    ? ctx.cache
      ? `\n  system: ${jsLiteral([{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], '  ')},`
      : `\n  system: "${esc(sys)}",`
    : '';
  return `${imageNote(ctx, 'js', 'messages')}${tsClient(d, ctx.baseUrl)}

const ${d.resultVar} = await ${d.call}({
  model: "${model.id}",${systemTs}
  messages: ${messagesLiteral('messages', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${tsTail(d, stream)}`;
}

export function tsResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const d = def('responses');
  const params = sdkParamLines(buildBody('responses', ctx), 'js', 'responses', '  ');
  return `${imageNote(ctx, 'js', 'responses')}${tsClient(d, ctx.baseUrl)}

const ${d.resultVar} = await ${d.call}({
  model: "${model.id}",${sys ? `\n  instructions: "${esc(sys)}",` : ''}
  input: ${messagesLiteral('responses', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${tsTail(d, stream)}`;
}

export function tsGemini(ctx: CodeGenCtx): string {
  const d = def('gemini');
  const { contents, config } = geminiSdkCall(buildBody('gemini', ctx), false);
  const cfgLine = Object.keys(config).length ? `\n  config: ${jsLiteral(config, '  ')},` : '';
  // @google/genai 用 httpOptions.baseUrl，构造形状与 OpenAI/Anthropic 不同，故不复用 tsClient。
  return `${imageNote(ctx, 'js', 'gemini')}${d.imports.join('\n')}

const ${d.clientVar} = ${d.clientCtor}({
  apiKey: "${API_KEY_PLACEHOLDER}",
  httpOptions: { baseUrl: "${ctx.baseUrl}${d.baseSuffix}" },
});

const ${d.resultVar} = await ${d.call}({
  model: "${ctx.model.id}",
  contents: ${jsLiteral(contents, '  ')},${cfgLine}
});
${d.read}`;
}
