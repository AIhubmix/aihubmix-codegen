/**
 * decision cURL renderer。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { shellSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionCurl(ctx: DecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '  ').trim();
  return `${decisionNote('#')}
curl ${ctx.baseUrl}${ctx.path} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" \\
  -d '${shellSafe(bodyStr)}'`;
}
