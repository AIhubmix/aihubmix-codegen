/**
 * OpenAI Decisions TypeScript / JavaScript renderer（官方 openai SDK 的 client.decisions.create）。
 *
 * 产物同时要能当 .mjs 直接跑（verify harness 的 javascript 运行方式），所以不写类型注解；
 * answers 是按 `type` 判别的联合类型，if 分支在 TS 里照样收窄。
 */
import { OPENAI_DECISION_SDK } from '../../config/openai-decision.js';
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { jsLiteral } from '../../emit/literal.js';
import { openaiDecisionNote } from './shared.js';
import type { OpenAIDecisionCtx } from '../../wire/openai-decision.js';

export function openaiDecisionTs(ctx: OpenAIDecisionCtx): string {
  const sdk = OPENAI_DECISION_SDK.javascript;
  return `// Needs an SDK version with client.decisions: ${sdk.install}
${sdk.imports.join('\n')}

${openaiDecisionNote('//')}
const client = ${sdk.clientCtor}({
  apiKey: ${ENV_KEY_EXPR.javascript},
  baseURL: "${ctx.baseUrl}${sdk.baseSuffix}",
});

const decision = await ${sdk.call}(${jsLiteral(ctx.bodyObj, '')});

for (const answer of decision.answers) { // same order as questions
  if (answer.type === "predicate") {
    console.log(answer.name, "probability:", answer.probability);
  } else if (answer.type === "choice") {
    console.log(answer.name, "choice:", answer.choice, "confidence:", answer.confidence);
  } else if (answer.type === "score") {
    console.log(answer.name, "score:", answer.score, "confidence:", answer.confidence);
  } else { // refusal
    console.log(answer.name, "refused");
  }
}
console.log("input_tokens:", decision.usage.input_tokens);`;
}
