/**
 * Java renderer（java.net.http）：一个 javaRaw 吃 4 协议。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { javaTextBlockSafe } from '../emit/escape.js';
import { authHeaders } from '../wire/auth.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';

export function javaRaw(proto: CodeProto, ctx: CodeGenCtx): string {
  // 文本块内统一缩进 8 空格（与闭合 """ 同列）→ Java 去除附带缩进后得到顶格 JSON。
  // javaTextBlockSafe 翻倍反斜杠,抵消 Java 文本块的二次解转义(否则含 " / \ 的内容会破坏 JSON)。
  const body = javaTextBlockSafe(JSON.stringify(buildBody(proto, ctx), null, 2));
  const headers = authHeaders(proto)
    .map((h) => `        .header("${h.name}", "${h.value}")`)
    .join('\n');
  return `import java.net.URI;
import java.net.http.*;

public class Main {
    public static void main(String[] args) throws Exception {
        String body = """
${body}
        """;

        HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("${BASE}${endpointPath(proto, ctx)}"))
        .header("Content-Type", "application/json")
${headers}
        .POST(HttpRequest.BodyPublishers.ofString(body))
        .build();

        HttpResponse<String> response = HttpClient.newHttpClient()
            .send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}`;
}
