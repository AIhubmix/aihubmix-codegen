/**
 * decision Java renderer（java.net.http）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { javaTextBlockSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionJava(ctx: DecisionCtx): string {
  // 不预缩进：`javaTextBlockSafe` 自己会给每行加 8 空格（同 media/java.ts）。
  const bodyStr = jsonLines(ctx.bodyObj, '');
  return `import java.net.URI;
import java.net.http.*;

public class Main {
${decisionNote('//', '    ')}
    public static void main(String[] args) throws Exception {
        String body = """
${javaTextBlockSafe(bodyStr)}
        """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("${ctx.baseUrl}${ctx.path}"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + ${ENV_KEY_EXPR.java})
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        HttpResponse<String> response = HttpClient.newHttpClient()
            .send(request, HttpResponse.BodyHandlers.ofString());

        System.out.println(response.body());
    }
}`;
}
