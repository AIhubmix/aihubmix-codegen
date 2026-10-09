/**
 * OpenAI Decisions Java renderer（java.net.http）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { javaTextBlockSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { openaiDecisionNote } from './shared.js';
import type { OpenAIDecisionCtx } from '../../wire/openai-decision.js';

export function openaiDecisionJava(ctx: OpenAIDecisionCtx): string {
  // 不预缩进：`javaTextBlockSafe` 自己会给每行加 8 空格（同 decision/java.ts）。
  const bodyStr = jsonLines(ctx.bodyObj, '');
  return `import java.net.URI;
import java.net.http.*;

public class Main {
${openaiDecisionNote('//', '    ')}
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
