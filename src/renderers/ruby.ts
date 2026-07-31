/**
 * Ruby renderer。
 * chat / responses 走 ruby-openai gem（支持 uri_base 指向网关，不带 /v1）；
 * messages / gemini 走原生 net/http —— ruby-anthropic gem 不支持自定义 base URL，无法指向网关；
 * gemini 无官方 ruby SDK。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { API_KEY_PLACEHOLDER } from '../config/placeholders.js';
import { SDK, type SdkDef } from '../config/sdk.js';
import { rubyEsc, rubyStr } from '../emit/escape.js';
import { jsonLines, rubyParamLines } from '../emit/literal.js';
import { authHeaders } from '../wire/auth.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';
import { messagesLiteral, rubyImageNote } from './shared.js';

/** net/http 的 header 写法：request["Name"] = "Value"。 */
function rubyHeaders(proto: CodeProto): string {
  return authHeaders(proto)
    .map((h) => `request["${h.name}"] = "${h.value}"`)
    .join('\n');
}

/** 取 SDK 记录；ruby 只有 chat / responses 两条（见文件头注释）。 */
function def(proto: CodeProto): SdkDef {
  const d = SDK.ruby?.[proto];
  if (!d) throw new Error(`config/sdk.ts 缺 ruby × ${proto} 记录`);
  return d;
}

/** ruby-openai 客户端构造（access_token + uri_base）。 */
function rubyClient(d: SdkDef, baseUrl: string): string {
  return `${d.imports.join('\n')}

${d.clientVar} = ${d.clientCtor}(
  access_token: "${API_KEY_PLACEHOLDER}",
  uri_base: "${baseUrl}${d.baseSuffix}"
)`;
}

export function rubyChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const d = def('chat');
  const params = rubyParamLines(buildBody('chat', ctx), '    ');
  // ruby-openai 的流式是「参数」形态（stream: proc {...}），不是尾部消费循环。
  const streamLine = stream ? `\n    ${d.streamParam}` : '';
  return `${rubyImageNote(ctx, 'chat')}${rubyClient(d, ctx.baseUrl)}

${d.resultVar} = ${d.call}(
  parameters: {
    model: ${rubyStr(model.id)},
    messages: ${messagesLiteral('chat', ctx, 'ruby', '    ')},
${params}${streamLine}
  }
)
${stream ? '' : `\n${d.read}`}`;
}

export function rubyResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const d = def('responses');
  const params = rubyParamLines(buildBody('responses', ctx), '    ');
  const streamLine = stream ? `\n    ${d.streamParam}` : '';
  return `${rubyImageNote(ctx, 'responses')}${rubyClient(d, ctx.baseUrl)}

${d.resultVar} = ${d.call}(
  parameters: {
    model: ${rubyStr(model.id)},${sys ? `\n    instructions: "${rubyEsc(sys)}",` : ''}
    input: ${messagesLiteral('responses', ctx, 'ruby', '    ')},
${params}${streamLine}
  }
)
${stream ? '' : `\n${d.read}`}`;
}

export function rubyMessages(ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody('messages', ctx), '');
  const headers = rubyHeaders('messages');
  return `# The ruby-anthropic gem cannot point at a custom base URL, so the messages protocol uses net/http directly.
require "net/http"
require "uri"

uri = URI("${ctx.baseUrl}${endpointPath('messages', ctx)}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
${headers}
request.body = <<~'JSON'
${body}
JSON

response = http.request(request)
puts response.body`;
}

export function rubyGemini(ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody('gemini', ctx), '');
  const headers = rubyHeaders('gemini');
  return `require "net/http"
require "uri"

uri = URI("${ctx.baseUrl}${endpointPath('gemini', ctx)}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
${headers}
request.body = <<~'JSON'
${body}
JSON

response = http.request(request)
puts response.body`;
}
