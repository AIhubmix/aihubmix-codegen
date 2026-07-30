/**
 * 媒体 Ruby renderer（net/http 原始请求）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { BASE } from '../../config/placeholders.js';
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

${note}# 同步文生图：POST ${ctx.submitPath}（阻塞返回统一任务对象）
uri = URI("${BASE}${ctx.submitPath}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["Authorization"] = "Bearer AIHUBMIX_API_KEY"
request.body = <<~'JSON'
${bodyStr}
JSON

response = http.request(request)
data = JSON.parse(response.body)
# 结果在 data["output"] 列表，每项含 b64_json 或 content_url
# （content_url 下载需带同一 Bearer，约 30 分钟过期）
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

# 异步文生视频：Step 1 提交任务，Step 2 轮询直至完成
BASE = "${BASE}"
AUTH = "Bearer AIHUBMIX_API_KEY"

# Step 1：提交视频生成任务
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
puts "任务已提交，video_id: #{video_id}"

# Step 2：轮询任务状态直至终态 completed / failed / cancelled
loop do
  sleep 5
  poll_uri = URI("#{BASE}${pollPath}")
  poll = Net::HTTP::Get.new(poll_uri)
  poll["Authorization"] = AUTH
  result = JSON.parse(Net::HTTP.start(poll_uri.host, poll_uri.port, use_ssl: true) { |h| h.request(poll) }.body)
  status = result["status"]
  puts "状态: #{status}"
  if status == "completed"
    # 结果在 output[0]["content_url"]，下载需带同一 Bearer（约 30 分钟过期）
    puts "生成完成，下载地址（需带 Bearer）：#{result.dig("output", 0, "content_url")}"
    break
  end
  if %w[failed cancelled].include?(status)
    puts "任务结束 (#{status})"
    break
  end
end`;
}
