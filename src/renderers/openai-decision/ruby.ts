/**
 * OpenAI Decisions Ruby renderer（net/http 原始请求；ruby-openai 没有 decisions）。
 *
 * body 走单引号 heredoc（<<~'JSON'）：不插值、不解转义，用户输入里的 `#{}` 原样是数据。
 */
import { RUBY_KEY_INTERP } from '../../config/placeholders.js';
import { jsonLines } from '../../emit/literal.js';
import { openaiDecisionNote } from './shared.js';
import type { OpenAIDecisionCtx } from '../../wire/openai-decision.js';

export function openaiDecisionRuby(ctx: OpenAIDecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '');
  return `require "net/http"
require "uri"
require "json"

${openaiDecisionNote('#')}
uri = URI("${ctx.baseUrl}${ctx.path}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = uri.scheme == "https"

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["Authorization"] = "Bearer ${RUBY_KEY_INTERP}"
request.body = <<~'JSON'
${bodyStr}
JSON

response = http.request(request)
abort "HTTP #{response.code}: #{response.body}" unless response.is_a?(Net::HTTPSuccess)

data = JSON.parse(response.body)
data["answers"].each do |answer| # same order as questions
  case answer["type"]
  when "predicate" then puts [answer["name"], "probability:", answer["probability"]].join(" ")
  when "choice" then puts [answer["name"], "choice:", answer["choice"], "confidence:", answer["confidence"]].join(" ")
  when "score" then puts [answer["name"], "score:", answer["score"], "confidence:", answer["confidence"]].join(" ")
  else puts [answer["name"], "refused"].join(" ") # refusal
  end
end
puts "input_tokens: #{data["usage"]["input_tokens"]}"`;
}
