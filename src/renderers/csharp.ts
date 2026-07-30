/**
 * C# / .NET renderer（HttpClient）：一个 csRaw 吃 4 协议。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { authHeaders } from '../wire/auth.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';

export function csRaw(proto: CodeProto, ctx: CodeGenCtx): string {
  // 原始字符串字面量：内容顶格、与闭合 """ 同列（0 缩进）→ 不剔除任何前导空白。
  const body = JSON.stringify(buildBody(proto, ctx), null, 2);
  const headers = authHeaders(proto)
    .map((h) => `client.DefaultRequestHeaders.Add("${h.name}", "${h.value}");`)
    .join('\n');
  return `using System.Net.Http;
using System.Text;

var client = new HttpClient();
${headers}

var json = """
${body}
""";

var content = new StringContent(json, Encoding.UTF8, "application/json");
var response = await client.PostAsync("${BASE}${endpointPath(proto, ctx)}", content);
var result = await response.Content.ReadAsStringAsync();

Console.WriteLine(result);`;
}
