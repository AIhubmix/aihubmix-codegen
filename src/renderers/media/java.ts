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
  // 不预缩进：`javaTextBlockSafe` 自己会给每行加 8 空格。再传一层 indent 就是加两遍，
  // 文本块的「公共缩进剥离」按最小缩进算，结果是内容整体右飘、`}` 和 `{` 对不齐。
  const bodyStr = jsonLines(ctx.bodyObj, '');
  const note = mpNote(ctx, '    ');
  return `import java.net.URI;
import java.net.http.*;

public class Main {
${note}    // Synchronous image generation: POST ${ctx.submitPath} (blocking; returns the unified task
    // object, results in output[] — each item carries b64_json or content_url. Downloading a
    // content_url needs the same Bearer token and the link expires in about 30 minutes.)
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
//
// 这段模板里**一个反斜杠都不许写**。它是 JS 模板字符串，`\"` 会在这一层就塌成 `"`，
// 生成出来的 Java 变成 `contains(""completed"")` —— 编译不过，而且肉眼极难看出来
// （历史上就是这么坏掉的）。所以取值全部经 `q`（Java 字符字面量 '"' 无需转义）拼，
// 正则里的空白用 ` *` 而不是 `\s`（Java 15 起字面量中的 `\s` 是「空格转义」，不是正则空白类）。
// tests 里有一条断言把这条红线钉住了。
//
// 轮询终态也**读 status 字段**、不拿整个响应体做 `contains` 子串匹配：prompt 或 error 文案里
// 出现 "completed" 这个词就会让循环提前跳出。其余 5 门语言这里本来就是读字段，Java 是唯一
// 的例外（标准库没有 JSON 解析器，作者当年就近用了 contains）。
export function mediaVideoJava(ctx: MediaCtx): string {
  // 不预缩进，理由同 mediaImageJava
  const bodyStr = jsonLines(ctx.bodyObj, '');
  // `{id}` 换成拼接表达式。id 在路径末尾（默认就是）时会剩一截 `+ ""` 的空尾巴，
  // 在开头时会剩 `"" +` —— 都合法但难看，而且会让「Java 代码里不该出现 `""`」
  // 这条测试判据失效，所以在这里收干净。
  const pollUri = `"${ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`}"`
    .replace(/\{(id|video_id|task_id)\}/g, '" + videoId + "')
    .replace(/ \+ ""$/, '')
    .replace(/^"" \+ /, '');
  return `import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Main {
    // Minimal JSON field reader: the Java standard library has no JSON parser and this sample
    // pulls in no third-party dependency. Use Jackson/Gson in production — this regex only
    // matches top-level string values, not nested objects or numbers.
    static String field(String json, String key) {
        String q = String.valueOf('"');
        Matcher m = Pattern.compile(q + key + q + " *: *" + q + "([^" + q + "]*)" + q).matcher(json);
        // find() takes the **first** match. The submit response carries another "id" inside
        // output[], so a greedy .*"id" would grab the wrong one. Return "" when nothing matches —
        // never fall back to the whole body.
        return m.find() ? m.group(1) : "";
    }

    // Async video generation: Step 1 submit, Step 2 poll
    public static void main(String[] args) throws Exception {
        String apiKey = "${API_KEY_PLACEHOLDER}";
        String base = "${ctx.baseUrl}";
        HttpClient client = HttpClient.newHttpClient();

        // Step 1: submit the generation task
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
        String videoId = field(submitBody, "id");
        System.out.println("Submitted, videoId: " + videoId);

        // Step 2: poll until a terminal status (completed / failed / cancelled).
        // On completed the result is in output[0].content_url — downloading needs the same
        // Bearer token and the link expires in about 30 minutes.
        while (true) {
            Thread.sleep(5000);
            HttpRequest poll = HttpRequest.newBuilder()
                .uri(URI.create(base + ${pollUri}))
                .header("Authorization", "Bearer " + apiKey)
                .GET()
                .build();
            String pollBody = client.send(poll, HttpResponse.BodyHandlers.ofString()).body();
            String status = field(pollBody, "status");
            System.out.println("status: " + status);
            if (status.equals("completed")) break;
            if (status.equals("failed") || status.equals("cancelled")) {
                System.out.println("Task ended: " + status);
                break;
            }
        }
    }
}`;
}
