/**
 * 媒体 Ruby renderer（net/http 原始请求）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { jsonLines } from '../../emit/literal.js';
import { mpNote, type MediaCtx } from '../../wire/media.js';

// ---- 图：Ruby（net/http 原始请求） ----
export function mediaImageRuby(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '');
  const note = mpNote(ctx, '', '#');
  return `require "net/http"
require "uri"
require "json"

${note}# Synchronous image generation: POST ${ctx.submitPath} (blocking; returns the unified task object)
uri = URI("${ctx.baseUrl}${ctx.submitPath}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["Authorization"] = "Bearer ${API_KEY_PLACEHOLDER}"
request.body = <<~'JSON'
${bodyStr}
JSON

response = http.request(request)
data = JSON.parse(response.body)
# Results are in data["output"] — each item carries b64_json or content_url
# (downloading a content_url needs the same Bearer; the link expires in about 30 minutes)
(data["output"] || []).each do |item|
  puts item["content_url"] || (item["b64_json"] || "")[0, 80]
end`;
}

// ---- 视频：Ruby（提交 + 轮询） ----
export function mediaVideoRuby(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '');
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '#{video_id}');
  return `require "net/http"
require "uri"
require "json"

# Async video generation: Step 1 submit, Step 2 poll until done
BASE = "${ctx.baseUrl}"
AUTH = "Bearer ${API_KEY_PLACEHOLDER}"

# Step 1: submit the generation task
uri = URI("#{BASE}${ctx.submitPath}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true
submit = Net::HTTP::Post.new(uri)
submit["Content-Type"] = "application/json"
submit["Authorization"] = AUTH
submit.body = <<~'JSON'
${bodyStr}
JSON
video_id = JSON.parse(http.request(submit).body)["id"]
puts "Submitted, video_id: #{video_id}"

# Step 2: poll until a terminal status (completed / failed / cancelled)
loop do
  sleep 5
  poll_uri = URI("#{BASE}${pollPath}")
  poll = Net::HTTP::Get.new(poll_uri)
  poll["Authorization"] = AUTH
  result = JSON.parse(Net::HTTP.start(poll_uri.host, poll_uri.port, use_ssl: true) { |h| h.request(poll) }.body)
  status = result["status"]
  puts "status: #{status}"
  if status == "completed"
    # Result is in output[0]["content_url"] — downloading needs the same Bearer (expires in ~30 min)
    puts "Done. Download URL (send the same Bearer): #{result.dig("output", 0, "content_url")}"
    break
  end
  if %w[failed cancelled].include?(status)
    puts "Task ended (#{status})"
    break
  end
end`;
}
