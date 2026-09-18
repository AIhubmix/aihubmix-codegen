/**
 * decision C# renderer（HttpClient）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { jsonLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionCs(ctx: DecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '    ').trim();
  return `using System.Net.Http;
using System.Text;

${decisionNote('//')}
var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer " + ${ENV_KEY_EXPR.csharp});

var json = """
${bodyStr}
""";

var content = new StringContent(json, Encoding.UTF8, "application/json");
var response = await client.PostAsync("${ctx.baseUrl}${ctx.path}", content);
var result = await response.Content.ReadAsStringAsync();

Console.WriteLine(result);`;
}
