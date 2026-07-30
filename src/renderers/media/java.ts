/**
 * 媒体 Java renderer（java.net.http）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { javaTextBlockSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { mpNote, type MediaCtx } from '../../wire/media.js';

// ---- 图：Java（java.net.http） ----
export function mediaImageJava(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '            ').trim();
  const note = mpNote(ctx, '    ');
  return `import java.net.URI;
import java.net.http.*;

public class Main {
${note}    // 同步文生图：POST ${ctx.submitPath}（阻塞返回统一任务对象，结果在 output[]，
    // 每项含 b64_json 或 content_url；content_url 下载需带同一 Bearer，约 30 分钟过期）
    public static void main(String[] args) throws Exception {
        String body = """
${javaTextBlockSafe(bodyStr)}
        """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("${ctx.baseUrl}${ctx.submitPath}"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer ${API_KEY_PLACEHOLDER}")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        HttpResponse<String> response = HttpClient.newHttpClient()
            .send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}`;
}

// ---- 视频：Java（java.net.http，提交 + 轮询） ----
export function mediaVideoJava(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '            ').trim();
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '" + videoId + "');
  return `import java.net.URI;
import java.net.http.*;
import java.time.Duration;

public class Main {
    // 异步文生视频：Step 1 提交，Step 2 轮询
    public static void main(String[] args) throws Exception {
        String apiKey = "${API_KEY_PLACEHOLDER}";
        String base = "${ctx.baseUrl}";
        HttpClient client = HttpClient.newHttpClient();

        // Step 1：提交视频生成任务
        String body = """
${javaTextBlockSafe(bodyStr)}
        """;
        HttpRequest submit = HttpRequest.newBuilder()
            .uri(URI.create(base + "${ctx.submitPath}"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + apiKey)
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        String submitBody = client.send(submit, HttpResponse.BodyHandlers.ofString()).body();
        // 简单解析 videoId（生产环境建议用 Jackson/Gson）
        String videoId = submitBody.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        System.out.println("任务已提交，videoId: " + videoId);

        // Step 2：轮询任务状态（终态 completed / failed / cancelled；
        // completed 时结果在 output[0].content_url，下载需带同一 Bearer，约 30 分钟过期）
        while (true) {
            Thread.sleep(5000);
            HttpRequest poll = HttpRequest.newBuilder()
                .uri(URI.create(base + "${pollPath}"))
                .header("Authorization", "Bearer " + apiKey)
                .GET()
                .build();
            String pollBody = client.send(poll, HttpResponse.BodyHandlers.ofString()).body();
            System.out.println("轮询响应: " + pollBody);
            if (pollBody.contains("\"completed\"")) break;
            if (pollBody.contains("\"failed\"") || pollBody.contains("\"cancelled\"")) break;
        }
    }
}`;
}
