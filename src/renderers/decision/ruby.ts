/**
 * decision Ruby renderer（net/http 原始请求）。
 */
import { RUBY_KEY_INTERP } from '../../config/placeholders.js';
import { jsonLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionRuby(ctx: DecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '');
  return `require "net/http"
require "uri"
require "json"

${decisionNote('#')}
uri = URI("${ctx.baseUrl}${ctx.path}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["Authorization"] = "Bearer ${RUBY_KEY_INTERP}"
request.body = <<~'JSON'
${bodyStr}
JSON

data = JSON.parse(http.request(request).body)
(data["answers"] || {}).each do |name, answer|
  kind = answer["type"]
  puts [name, kind, answer[kind], answer["confidence"]].inspect
end
puts "usage: #{data['usage']}"`;
}
