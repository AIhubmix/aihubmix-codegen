/**
 * test-verify-classify.mjs —— verify-codegen classify() 判定单测(TASK-C3PSS8)。
 * 覆盖回归点:思考型模型合法 200(usage token=429/503、thoughtSignature、思考正文)不再假红;
 * 真错信封(对象/字符串/中文)、traceback、HTTP 状态码仍判失败。
 *   node scripts/test-verify-classify.mjs
 */
import { classify, missingAnswers } from './verify-codegen.mjs';

let pass = 0, fail = 0;
// 期望 want: true=通过(ok===true) / false=失败(ok===false)
function t(name, input, want) {
  const r = classify(input);
  const got = r.ok;
  const good = got === want;
  if (good) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — 期望 ok=${want}，实得 ok=${got}；note=${r.note}`); }
}

console.log('结构化优先 — 合法 200 不再误判：');
// 思考模型:completion_tokens 恰好=503(撞旧黑名单 \b50[0234]\b)
t('chat 200 / completion_tokens=503',
  { code: 0, out: '{"id":"chatcmpl-x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":503,"total_tokens":515}}' },
  true);
// 思考模型:reasoning_tokens=429(撞旧黑名单 \b429\b)
t('responses 200 / reasoning_tokens=429 / error:null',
  { code: 0, out: '{"id":"resp_1","object":"response","output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":9,"output_tokens":429,"output_tokens_details":{"reasoning_tokens":429}},"error":null}' },
  true);
// gemini thoughtSignature base64(含 +// 词边界 + 数字)
t('chat 200 / thoughtSignature base64',
  { code: 0, out: '{"id":"g1","choices":[{"message":{"content":"ok","thoughtSignature":"Cg429aB+/50xZ/Qk503+Iw=="},"finish_reason":"stop"}],"usage":{"total_tokens":502}}' },
  true);
// deepseek 思考正文含 "invalid"/"exception" 等日常词,但在 JSON body 内 → 只认 error
t('chat 200 / reasoning_content 含 invalid/exception',
  { code: 0, out: '{"id":"ds1","choices":[{"message":{"content":"ok","reasoning_content":"the request looked invalid so I considered an exception but it is fine"}}],"usage":{"completion_tokens":88},"error":null}' },
  true);
// anthropic messages 成功(无 error 字段)
t('messages 200 / anthropic 无 error 字段',
  { code: 0, out: '{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":10,"output_tokens":500}}' },
  true);
// SDK 纯文本内容(prompt=Reply with exactly: ok → "ok"),无信封 → 兜底黑名单,benign
t('chat SDK 纯文本 "ok"', { code: 0, out: 'ok\n' }, true);
// 流式:多块 SSE 全部正常
t('stream 200 / SSE 多块正常',
  { code: 0, out: 'data: {"choices":[{"delta":{"content":"o"}}]}\n\ndata: {"choices":[{"delta":{"content":"k"}}],"usage":{"completion_tokens":503}}\n\ndata: [DONE]\n' },
  true);

console.log('\n真错仍判失败：');
t('error 对象信封', { code: 0, out: '{"error":{"type":"invalid_request_error","message":"bad key","code":401}}' }, false);
t('error 字符串信封', { code: 0, out: '{"choices":[],"error":"model not available"}' }, false);
t('error 中文信封', { code: 0, out: '{"error":{"message":"余额不足，请充值"}}' }, false);
t('限流错误信封(code:429)', { code: 0, out: '{"error":{"message":"Rate limit exceeded","code":429,"type":"rate_limit_error"}}' }, false);
t('流式中途错误块', { code: 0, out: 'data: {"choices":[{"delta":{"content":"o"}}]}\n\ndata: {"error":{"message":"upstream overloaded"}}\n' }, false);
// 非 JSON:SDK 崩溃 traceback
t('python traceback(无信封)', { code: 1, out: 'Traceback (most recent call last):\n  File "run.py", line 9\n    raise openai.AuthenticationError\nopenai.AuthenticationError: invalid api key' }, false);
// 非 JSON:HTTP 状态行
t('HTTP 429 明文状态', { code: 0, out: 'HTTP 429 Too Many Requests\nretry later' }, false);
t('status code: 503 明文', { code: 0, out: 'request failed with status code 503' }, false);
// 打印成功信封后崩溃(exit≠0)不轻信 → 落兜底,exit≠0 判失败
t('成功信封但退出码非 0', { code: 1, out: '{"choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":50}}\nSegmentation fault' }, false);
// 顶层 {"message":...,"code":429} 无 error 键(不当成功信封;JSON 状态码锚兜底)
t('顶层无 error 键的限流体', { code: 0, out: '{"message":"server busy","code":429}' }, false);
t('顶层 status:503 无 error 键', { code: 0, out: '{"status":503,"detail":"service unavailable now"}' }, false);
// 空输出
t('空输出 exit 1', { code: 1, out: '' }, false);

console.log('\n裸数字不再触发(反例保护)：');
// 纯文本内容恰含 503/429 这种数字,但非状态码语境 → 不判失败
t('纯文本含孤立数字 503', { code: 0, out: 'the answer is 503 ok' }, true);

console.log('\n决策面（--surface decision / openai-decision）：');
// 响应顶层是 {model, answers, usage}，两个面的 answers 一个是数组一个是对象
t('openai-decision 200 / answers 数组',
  { code: 0, out: '{"model":"gpt-6-luna","answers":[{"type":"predicate","name":"is_billing_issue","probability":1.0}],"usage":{"input_tokens":461,"output_tokens":0}}' },
  true);
t('decision(/v1/systemone) 200 / answers 对象',
  { code: 0, out: '{"model":"jev-1.13.0","answers":{"is_urgent":{"type":"noul","noul":0.99}},"usage":{"input_tokens":424,"output_tokens":73}}' },
  true);
// 只有 answers 的信封：答案值里恰好有黑名单词（选项值叫 invalid）。不认 answers 为信封键时
// 会落到兜底黑名单，把合法 200 判成失败（假红）。
t('仅 answers 的信封 / 答案值含 invalid', { code: 0, out: '{"answers":[{"type":"choice","name":"status","choice":"invalid","confidence":0.9}]}' }, true);
// SDK / ruby 格逐题打印一行，不是 JSON —— 走兜底黑名单，题目名里没有黑名单词
t('openai-decision SDK 逐题打印', { code: 0, out: 'is_billing_issue probability: 1.0\ndepartment choice: billing confidence: 1.0\nurgency score: 2.0 confidence: 1.0\ninput_tokens: 461\n' }, true);
t('openai-decision 400 错误信封',
  { code: 0, out: '{"error":{"message":"Invalid \'questions[0].choices\': array too short.","type":"invalid_request_error","param":"questions[0].choices"}}' },
  false);
t('python SDK 版本过旧（无 decisions）', { code: 1, out: "Traceback (most recent call last):\nAttributeError: 'OpenAI' object has no attribute 'decisions'" }, false);

// 逐题核对：classify 只看「有没有 error」，决策面另要求每道题的名字都出现在输出里
function m(name, out, names, want) {
  const got = JSON.stringify(missingAnswers(out, names));
  if (got === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — 期望 ${JSON.stringify(want)}，实得 ${got}`); }
}
const NAMES = ['is_billing_issue', 'department', 'urgency'];
m('missingAnswers：三题都在 → 空', 'is_billing_issue 1\ndepartment billing\nurgency 2', NAMES, []);
m('missingAnswers：缺一题 → 点名', '{"answers":[{"name":"is_billing_issue"},{"name":"department"}]}', NAMES, ['urgency']);
m('missingAnswers：空输出 → 全缺', '', NAMES, NAMES);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
