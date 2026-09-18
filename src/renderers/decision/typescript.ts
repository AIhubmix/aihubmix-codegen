/**
 * decision TypeScript / JavaScript renderer（fetch，无 SDK）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { blockLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionTs(ctx: DecisionCtx): string {
  const bodyStr = blockLines(ctx.bodyObj, '  ');
  return `${decisionNote('//')}
const response = await fetch("${ctx.baseUrl}${ctx.path}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + ${ENV_KEY_EXPR.javascript},
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${bodyStr}),
});
if (!response.ok) throw new Error(\`HTTP \${response.status}\`);

const data = await response.json();
for (const [name, answer] of Object.entries(data.answers ?? {})) {
  console.log(name, answer.type, answer[answer.type], answer.confidence);
}
console.log("usage:", data.usage);`;
}
