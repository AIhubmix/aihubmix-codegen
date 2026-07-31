/**
 * 媒体 C# renderer（HttpClient）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { jsonLines } from '../../emit/literal.js';
import { mpNote, type MediaCtx } from '../../wire/media.js';

// ---- 图：C# ----
export function mediaImageCs(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '    ').trim();
  const note = mpNote(ctx);
  return `using System.Net.Http;
using System.Text;

${note}// Synchronous image generation: POST ${ctx.submitPath} (blocking; returns the unified task
// object, results in output[] — each item carries b64_json or content_url. Downloading a
// content_url needs the same Bearer token and the link expires in about 30 minutes.)
var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer " + ${ENV_KEY_EXPR.csharp});

var json = """
${bodyStr}
""";

var content = new StringContent(json, Encoding.UTF8, "application/json");
var response = await client.PostAsync("${ctx.baseUrl}${ctx.submitPath}", content);
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

// Async video generation: Step 1 submit, Step 2 poll
var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer " + ${ENV_KEY_EXPR.csharp});
var baseUrl = "${ctx.baseUrl}";

// Step 1: submit the generation task
var json = """
${bodyStr}
""";
var content = new StringContent(json, Encoding.UTF8, "application/json");
var submitResp = await client.PostAsync($"{baseUrl}${ctx.submitPath}", content);
var submitBody = await submitResp.Content.ReadAsStringAsync();
var submitDoc = JsonDocument.Parse(submitBody);
var videoId = submitDoc.RootElement.GetProperty("id").GetString();
Console.WriteLine($"Submitted, videoId: {videoId}");

// Step 2: poll until a terminal status (completed / failed / cancelled)
while (true) {
    await Task.Delay(5000);
    var pollResp = await client.GetAsync($"{baseUrl}${pollPath}");
    var pollBody = await pollResp.Content.ReadAsStringAsync();
    var doc = JsonDocument.Parse(pollBody);
    var status = doc.RootElement.GetProperty("status").GetString();
    Console.WriteLine($"status: {status}");
    if (status is "completed") {
        // Result is in output[0].content_url — downloading needs the same Bearer (expires in ~30 min)
        var url = doc.RootElement.GetProperty("output")[0].GetProperty("content_url").GetString();
        Console.WriteLine("Done. Download URL (send the same Bearer): " + url);
        break;
    }
    if (status is "failed" or "cancelled") { Console.WriteLine("Task ended: " + status); break; }
}`;
}
