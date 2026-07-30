/**
 * cURL renderer：一个 curl 吃 4 协议。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { shellSafe } from '../emit/escape.js';
import { jsonLines } from '../emit/literal.js';
import { authHeaders } from '../wire/auth.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';

export function curl(proto: CodeProto, ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody(proto, ctx), '  ').trim();
  const headers = authHeaders(proto)
    .map((h) => `  -H "${h.name}: ${h.value}" \\`)
    .join('\n');
  return `curl ${BASE}${endpointPath(proto, ctx)} \\
  -H "Content-Type: application/json" \\
${headers}
  -d '${shellSafe(body)}'`;
}
