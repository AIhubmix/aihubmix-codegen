/**
 * Ruby renderer。
 * chat / responses 走 ruby-openai gem（支持 uri_base 指向网关，不带 /v1）；
 * messages / gemini 走原生 net/http —— ruby-anthropic gem 不支持自定义 base URL，无法指向网关；
 * gemini 无官方 ruby SDK。
 */
import type { CodeGenCtx } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { rubyEsc, rubyStr } from '../emit/escape.js';
import { jsonLines, rubyParamLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';
import { messagesLiteral, rubyImageNote } from './shared.js';

export function rubyChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const params = rubyParamLines(buildBody('chat', ctx), '    ');
  const streamLine = stream
    ? `\n    stream: proc { |chunk, _event| print chunk.dig("choices", 0, "delta", "content") },`
    : '';
  return `${rubyImageNote(ctx, 'chat')}require "openai"

client = OpenAI::Client.new(
  access_token: "AIHUBMIX_API_KEY",
  uri_base: "${BASE}"
)

response = client.chat(
  parameters: {
    model: ${rubyStr(model.id)},
    messages: ${messagesLiteral('chat', ctx, 'ruby', '    ')},
${params}${streamLine}
  }
)
${stream ? '' : '\nputs response.dig("choices", 0, "message", "content")'}`;
}

export function rubyResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const params = rubyParamLines(buildBody('responses', ctx), '    ');
  const streamLine = stream
    ? `\n    stream: proc { |chunk, _event| print chunk.dig("delta") },`
    : '';
  return `${rubyImageNote(ctx, 'responses')}require "openai"

client = OpenAI::Client.new(
  access_token: "AIHUBMIX_API_KEY",
  uri_base: "${BASE}"
)

response = client.responses.create(
  parameters: {
    model: ${rubyStr(model.id)},${sys ? `\n    instructions: "${rubyEsc(sys)}",` : ''}
    input: ${messagesLiteral('responses', ctx, 'ruby', '    ')},
${params}${streamLine}
  }
)
${stream ? '' : '\n# output[0] 可能是 reasoning，回复文本通常在最后一个 output 块\nputs response.dig("output", -1, "content", 0, "text")'}`;
}

export function rubyMessages(ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody('messages', ctx), '');
  return `# ruby-anthropic gem 不支持自定义 base URL，故 messages 协议用原生 net/http 指向网关。
require "net/http"
require "uri"

uri = URI("${BASE}${endpointPath('messages', ctx)}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["x-api-key"] = "AIHUBMIX_API_KEY"
request["anthropic-version"] = "2023-06-01"
request.body = <<~'JSON'
${body}
JSON

response = http.request(request)
puts response.body`;
}

export function rubyGemini(ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody('gemini', ctx), '');
  return `require "net/http"
require "uri"

uri = URI("${BASE}${endpointPath('gemini', ctx)}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["x-goog-api-key"] = "AIHUBMIX_API_KEY"
request.body = <<~'JSON'
${body}
JSON

response = http.request(request)
puts response.body`;
}
