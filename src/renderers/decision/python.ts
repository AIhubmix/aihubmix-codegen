/**
 * decision Python renderer（requests，无 SDK —— 上游只有一个同步 JSON 端点）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { pyLiteral } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionPy(ctx: DecisionCtx): string {
  const bodyStr = pyLiteral(ctx.bodyObj, '    ');
  return `import os
import requests

${decisionNote('#')}
url = "${ctx.baseUrl}${ctx.path}"
headers = {
    "Authorization": "Bearer " + ${ENV_KEY_EXPR.python},
    "Content-Type": "application/json",
}
payload = ${bodyStr}

response = requests.post(url, headers=headers, json=payload)
response.raise_for_status()

data = response.json()
for name, answer in data["answers"].items():
    kind = answer["type"]
    print(name, kind, answer[kind], answer.get("confidence"))
print("usage:", data.get("usage"))`;
}
