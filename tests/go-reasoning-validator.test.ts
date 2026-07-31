/**
 * go-openai 的客户端校验（`reasoning_validator.go`）—— go × chat 这一格独有的坑。
 *
 * 怎么发现的：线上真跑一遍 28 格（`verify:codegen` 打 aihubmix.com + gpt-5.5），
 * 27 格的失败都能归到环境（缺 runtime、模型不属于该协议），只有一格是我们自己的问题：
 *
 *     ✗ chat/go: panic: this model is not supported MaxTokens, please use MaxCompletionTokens
 *
 * 关键是它**不是网关拒的**：同一份 body 用 curl 发过去 200。go-openai 在
 * `CreateChatCompletion` 里、发请求之前就按**模型 id 前缀**（o1/o3/o4/gpt-5）拦了一批参数。
 * 所以这是「这个 SDK 的事实」，和 PY_OPENAI_NATIVE 是同一类东西，该住在 renderer 里。
 *
 * 两条各自独立的失败路径，下面分开测：
 *   1. MaxTokens / MaxCompletionTokens 选哪个 —— 选错直接 panic，一行输出都没有。
 *   2. temperature / top_p / n / penalty / logprobs —— 校验同样拦，但拦下之后必须
 *      **在代码里点名**，不能悄悄少发（「静默丢参数」是本包一直在防的那类失败）。
 */
import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/generate.js';
import { goReasoningModel } from '../src/renderers/go.js';
import { PARAM_KEYS, baseCtx, ctxWith } from './fixture.js';

/** 把 ReasoningValidator 会拦的参数全给上，逼渲染器逐条表态。 */
const BLOCKED_KEYS = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'n', 'top_logprobs'];

/**
 * 故意从 schema 里摘掉 `max_completion_tokens`。
 *
 * fixture 的 PARAM_KEYS 是「全量放行」的，本来就含它 —— 留着的话 MaxCompletionTokens
 * 会被**schema 那条触发条件**点亮，于是「模型 id 命中」这条新路径压根没被测到，
 * 非 reasoning 模型那组还会假红。这里只留 id 前缀这一个变量。
 */
const KEYS = PARAM_KEYS.filter((k) => k !== 'max_completion_tokens');

function chatGo(modelId: string): string {
  return generateCode('chat', 'go', ctxWith({
    model: { id: modelId },
    p: {
      ...baseCtx.p,
      temperature: 0.7,
      top_p: 0.9,
      n: 2,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      top_logprobs: 3,
    },
    paramKeys: KEYS,
  }));
}

describe('模型 id 前缀判定：镜像上游那条规则', () => {
  it('四个系列都认（上游 v1.41.2 的判据就是这四个 HasPrefix）', () => {
    for (const id of ['o1', 'o1-mini', 'o3', 'o3-pro', 'o4-mini', 'gpt-5', 'gpt-5.5', 'gpt-5.6-sol']) {
      expect(goReasoningModel(id), id).toBe(true);
    }
  });

  it('别的模型不误伤 —— 这些今天是绝大多数，判错等于整片少发参数', () => {
    for (const id of ['gpt-4o', 'gpt-4.1', 'claude-opus-5', 'kimi-k3', 'qwen3.8-max-preview', 'grok-4']) {
      expect(goReasoningModel(id), id).toBe(false);
    }
  });
});

describe('MaxTokens vs MaxCompletionTokens：判据是模型 id，不是 schema 声明', () => {
  it('reasoning 模型渲染 MaxCompletionTokens（线上 panic 的就是这条）', () => {
    const code = chatGo('gpt-5.5');
    expect(code).toContain('MaxCompletionTokens: 1024,');
    // 断言的是「struct 里没有 MaxTokens 这个字段」。不能直接搜 'MaxTokens'——
    // MaxCompletionTokens 里就含这个子串，那样恒真。
    expect(code).not.toContain('\t\t\tMaxTokens:');
  });

  it('schema 没声明 max_completion_tokens 也照样切（旧实现正是栽在这里）', () => {
    // 旧逻辑是 ctx.paramKeys.includes('max_completion_tokens')——要求调用方的 schema
    // 恰好声明了它。canon 今天覆盖 6/380 个模型，绝大多数走的是 paramKeys 为空的
    // 基础对话形式；那条路径下 gpt-5 系会渲染出 MaxTokens 然后当场 panic。
    const code = generateCode('chat', 'go', ctxWith({ model: { id: 'gpt-5.5' }, paramKeys: [] }));
    expect(code).toContain('MaxCompletionTokens: 1024,');
    expect(code).not.toContain('\t\t\tMaxTokens:');
  });

  it('非 reasoning 模型不受影响，仍是 MaxTokens', () => {
    const code = chatGo('gpt-4o');
    expect(code).toContain('MaxTokens: 1024,');
    expect(code).not.toContain('MaxCompletionTokens');
  });

  it('schema 显式声明 max_completion_tokens 时仍然认（两个触发条件取并集）', () => {
    const code = generateCode('chat', 'go', ctxWith({ paramKeys: ['max_completion_tokens'] }));
    expect(goReasoningModel(baseCtx.model.id)).toBe(false); // 不是靠 id 命中的
    expect(code).toContain('MaxCompletionTokens: 1024,');
  });
});

describe('被校验拦下的参数：让路，但必须点名', () => {
  it('六个参数一个都不渲染进请求结构体', () => {
    const code = chatGo('gpt-5.5');
    const structFields = code.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const f of ['Temperature:', 'TopP:', 'FrequencyPenalty:', 'PresencePenalty:', 'N:', 'LogProbs:', 'TopLogProbs:']) {
      expect(structFields, f).not.toContain(f);
    }
  });

  it('注释里逐个点名，并说清「是 SDK 拦的、不是网关拒的」', () => {
    // 少发参数而不出声是本包一直在防的失败模式：用户看到一段能跑的代码，
    // 却不知道自己设的 temperature 根本没上路。这里的措辞还要能指路——
    // 换个模型就能用，网关本身是收的。
    const code = chatGo('gpt-5.5');
    expect(code).toContain('reasoning_validator.go');
    for (const k of BLOCKED_KEYS) expect(code, k).toContain(k);
    expect(code).toContain('网关本身是收这些参数的');
  });

  it('两类「发不出去」分开说：没字段 vs 有字段但被拦', () => {
    // 原因不同、出路也不同（换 net/http vs 换模型），混成一句话会误导。
    const code = generateCode('chat', 'go', ctxWith({
      model: { id: 'gpt-5.5' },
      p: { ...baseCtx.p, temperature: 0.7, top_k: 40 },
      paramKeys: KEYS,
    }));
    expect(code).toContain('go-openai 的 ChatCompletionRequest 没有以下字段'); // top_k 走这条
    expect(code).toContain('reasoning_validator.go');                          // temperature 走那条
  });

  it('非 reasoning 模型不产这段注释（别给多数路径添噪音）', () => {
    const code = chatGo('gpt-4o');
    expect(code).not.toContain('reasoning_validator.go');
    expect(code).toContain('Temperature: 0.7,');
  });

  it('reasoning 模型下这段注释在 struct 之外，不会破坏语法', () => {
    // 注释是拼进函数体的，位置错了会插进 struct 字面量中间——Go 编不过。
    // 真正的编译验证在 scripts/test-codegen-escaping.mjs（跑 go build），这里只钉位置。
    const code = chatGo('gpt-5.5');
    const noteAt = code.indexOf('reasoning_validator.go');
    const structAt = code.indexOf('openai.ChatCompletionRequest{');
    expect(noteAt).toBeGreaterThan(-1);
    expect(noteAt).toBeLessThan(structAt);
  });
});
