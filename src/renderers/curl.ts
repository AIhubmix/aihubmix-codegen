/**
 * cURL renderer：一个 curl 吃 4 协议。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { shellSafe } from '../emit/escape.js';
import { jsonLines } from '../emit/literal.js';
import { authHeaders } from '../wire/auth.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';
import { API_KEY_PLACEHOLDER } from '../config/placeholders.js';

export function curl(proto: CodeProto, ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody(proto, ctx), '  ').trim();
  // key 出的是 shell 变量 `$AIHUBMIX_API_KEY` 而不是字面量：curl 是唯一「复制即跑」的语言，
  // 粘进终端就直接发出去了。出字面量的话用户要么先手改一处、要么把真 key 打进 shell 历史。
  // 媒体 curl 一直是这个形态，这里对齐（两边不一致本身就是坑）。其余六门语言不动 —— 它们
  // 要先存文件再跑，`os.environ` / `process.env` 各有各的写法，由各 renderer 自己决定。
  const headers = authHeaders(proto, `$${API_KEY_PLACEHOLDER}`)
    .map((h) => `  -H "${h.name}: ${h.value}" \\`)
    .join('\n');
  return `curl ${ctx.baseUrl}${endpointPath(proto, ctx)} \\
  -H "Content-Type: application/json" \\
${headers}
  -d '${shellSafe(body)}'`;
}
