/**
 * OpenAI Decisions Python renderer（官方 openai SDK 的 client.decisions.create）。
 *
 * body 的每个键原样渲染成一个关键字参数 —— 键集合由 buildOpenAIDecisionBody 决定，本文件不挑键，
 * 所以 Get Code 与真实请求不会因为这里漏写一个参数而分叉。
 */
import { OPENAI_DECISION_SDK } from '../../config/openai-decision.js';
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { pyLiteral } from '../../emit/literal.js';
import { openaiDecisionNote } from './shared.js';
import type { OpenAIDecisionCtx } from '../../wire/openai-decision.js';

export function openaiDecisionPy(ctx: OpenAIDecisionCtx): string {
  const sdk = OPENAI_DECISION_SDK.python;
  const kwargs = Object.entries(ctx.bodyObj)
    .map(([k, v]) => `    ${k}=${pyLiteral(v, '    ')},`)
    .join('\n');
  return `# Needs an SDK version with client.decisions: ${sdk.install}
import os
${sdk.imports.join('\n')}

${openaiDecisionNote('#')}
client = ${sdk.clientCtor}(
    api_key=${ENV_KEY_EXPR.python},
    base_url="${ctx.baseUrl}${sdk.baseSuffix}",
)

decision = ${sdk.call}(
${kwargs}
)

for answer in decision.answers:  # same order as questions
    if answer.type == "predicate":
        print(answer.name, "probability:", answer.probability)
    elif answer.type == "choice":
        print(answer.name, "choice:", answer.choice, "confidence:", answer.confidence)
    elif answer.type == "score":
        print(answer.name, "score:", answer.score, "confidence:", answer.confidence)
    else:  # refusal
        print(answer.name, "refused")
print("input_tokens:", decision.usage.input_tokens)`;
}
