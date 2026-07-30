/**
 * cURL renderer：一个 curl 吃 4 协议。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { shellSafe } from '../emit/escape.js';
import { jsonLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { endpointPath } from '../wire/endpoint.js';

export function curl(proto: CodeProto, ctx: CodeGenCtx): string {
  const body = jsonLines(buildBody(proto, ctx), '  ').trim();
  const headers =
    proto === 'messages'
      ? `  -H "x-api-key: AIHUBMIX_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\`
      : proto === 'gemini'
        ? `  -H "x-goog-api-key: AIHUBMIX_API_KEY" \\`
        : `  -H "Authorization: Bearer AIHUBMIX_API_KEY" \\`;
  return `curl ${BASE}${endpointPath(proto, ctx)} \\
  -H "Content-Type: application/json" \\
${headers}
  -d '${shellSafe(body)}'`;
}
