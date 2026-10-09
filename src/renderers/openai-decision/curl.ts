/**
 * OpenAI Decisions cURL renderer。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { shellSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { openaiDecisionNote } from './shared.js';
import type { OpenAIDecisionCtx } from '../../wire/openai-decision.js';

export function openaiDecisionCurl(ctx: OpenAIDecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '  ').trim();
  return `${openaiDecisionNote('#')}
curl ${ctx.baseUrl}${ctx.path} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" \\
  -d '${shellSafe(bodyStr)}'`;
}
