/**
 * 媒体 C# renderer（HttpClient）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { API_KEY_PLACEHOLDER, BASE } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { jsonLines } from '../../emit/literal.js';
import { mpNote, type MediaCtx } from '../../wire/media.js';

// ---- 图：C# ----
export function mediaImageCs(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '    ').trim();
  const note = mpNote(ctx);
  return `using System.Net.Http;
using System.Text;

${note}// 同步文生图：POST ${ctx.submitPath}（阻塞返回统一任务对象，结果在 output[]，
// 每项含 b64_json 或 content_url；content_url 下载需带同一 Bearer，约 30 分钟过期）
var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer ${API_KEY_PLACEHOLDER}");

var json = """
${bodyStr}
""";

var content = new StringContent(json, Encoding.UTF8, "application/json");
var response = await client.PostAsync("${BASE}${ctx.submitPath}", content);
var result = await response.Content.ReadAsStringAsync();

Console.WriteLine(result);`;
}

// ---- 视频：C#（提交 + 轮询） ----
export function mediaVideoCs(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '    ').trim();
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '{videoId}');
  return `using System.Net.Http;
using System.Text;
using System.Text.Json;

// 异步文生视频：Step 1 提交，Step 2 轮询
var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer ${API_KEY_PLACEHOLDER}");
var baseUrl = "${BASE}";

// Step 1：提交视频生成任务
var json = """
${bodyStr}
""";
var content = new StringContent(json, Encoding.UTF8, "application/json");
var submitResp = await client.PostAsync($"{baseUrl}${ctx.submitPath}", content);
var submitBody = await submitResp.Content.ReadAsStringAsync();
var submitDoc = JsonDocument.Parse(submitBody);
var videoId = submitDoc.RootElement.GetProperty("id").GetString();
Console.WriteLine($"任务已提交，videoId: {videoId}");

// Step 2：轮询任务状态（终态 completed / failed / cancelled）
while (true) {
    await Task.Delay(5000);
    var pollResp = await client.GetAsync($"{baseUrl}${pollPath}");
    var pollBody = await pollResp.Content.ReadAsStringAsync();
    var doc = JsonDocument.Parse(pollBody);
    var status = doc.RootElement.GetProperty("status").GetString();
    Console.WriteLine($"状态: {status}");
    if (status is "completed") {
        // 结果在 output[0].content_url，下载需带同一 Bearer（约 30 分钟过期）
        var url = doc.RootElement.GetProperty("output")[0].GetProperty("content_url").GetString();
        Console.WriteLine("生成完成，下载地址（需带 Bearer）：" + url);
        break;
    }
    if (status is "failed" or "cancelled") { Console.WriteLine("任务结束：" + status); break; }
}`;
}
