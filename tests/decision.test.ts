/**
 * decision（结构化决策）面：body 形状、空值判据、同源缝、7 门语言产出。
 *
 * 这一面与四协议正交 —— 它不是「生成文本」的第五种写法，而是另一件事：一份 state 进去，
 * 一张类型化 answers 表出来。所以它走独立入口 generateDecisionCode，本测试也独立于
 * 按 PROTOCOLS 遍历的那批测试。
 */
import { describe, expect, it } from 'vitest';
import {
  buildDecisionBody,
  DECISION_PATH,
  DECISION_QUESTIONS_PLACEHOLDER,
  DECISION_STATE_PLACEHOLDER,
  DECISION_TYPES,
  generateDecisionCode,
  LANGS,
  type DecisionQuestion,
} from '../src/index.js';

const BASE = 'https://aihubmix.com';
const MODEL = 'jev-1.13';

/** 一次混合三原语的真实形态（对照 2026-09-18 网关实测 200 的那次调用）。 */
const QUESTIONS: Record<string, DecisionQuestion> = {
  is_spam: { type: 'noul', instructions: 'Is this message spam?' },
  sentiment: {
    type: 'choice',
    instructions: "What is the sender's tone?",
    criteria: { calm: null, excited: null, angry: null },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this?',
    criteria: ['Can wait', 'This week', 'Today'],
  },
};

describe('buildDecisionBody：请求体形状', () => {
  it('三个键，顺序固定 model / state / questions', () => {
    const body = buildDecisionBody({ modelId: MODEL, state: 'hello', questions: QUESTIONS });
    expect(Object.keys(body)).toEqual(['model', 'state', 'questions']);
    expect(body.model).toBe(MODEL);
    expect(body.state).toBe('hello');
  });

  it('state 收字符串，也收结构化程序状态（对象/数组）', () => {
    expect(buildDecisionBody({ modelId: MODEL, state: { a: 1 } }).state).toEqual({ a: 1 });
    expect(buildDecisionBody({ modelId: MODEL, state: [1, 2] }).state).toEqual([1, 2]);
  });

  it('三种原语的 type 原样进 body（判别器不许被包改写）', () => {
    const qs = buildDecisionBody({ modelId: MODEL, questions: QUESTIONS })
      .questions as Record<string, DecisionQuestion>;
    expect(Object.keys(qs)).toEqual(['is_spam', 'sentiment', 'urgency']);
    expect(qs.is_spam.type).toBe('noul');
    expect(qs.sentiment.type).toBe('choice');
    expect(qs.urgency.type).toBe('score');
    // score 的 criteria 是**数组**（下标即档位号），不是对象——错了响应的 legend 对不上。
    expect(Array.isArray(qs.urgency.criteria)).toBe(true);
  });

  it('DECISION_TYPES 就是 body 里真出现的那三个 type', () => {
    const qs = buildDecisionBody({ modelId: MODEL, questions: QUESTIONS })
      .questions as Record<string, DecisionQuestion>;
    expect(Object.values(qs).map((q) => q.type).sort()).toEqual([...DECISION_TYPES].sort());
  });
});

describe('空值判据：没填的不下发，与 media 的 filterParams 同源', () => {
  it('空串 / 空对象 / 空数组的 instructions、criteria 都不进 body', () => {
    const qs = buildDecisionBody({
      modelId: MODEL,
      questions: {
        a: { type: 'noul', instructions: '', criteria: {} },
        b: { type: 'choice', criteria: [] },
        c: { type: 'score', instructions: undefined },
      },
    }).questions as Record<string, DecisionQuestion>;
    expect(qs.a).toEqual({ type: 'noul' });
    expect(qs.b).toEqual({ type: 'choice' });
    expect(qs.c).toEqual({ type: 'score' });
  });

  it('`{}` / `[]` 视为没填而不是显式空值 —— 下发过去会覆盖默认行为', () => {
    const body = buildDecisionBody({ modelId: MODEL, state: {}, questions: {} });
    expect(body.state).toEqual(DECISION_STATE_PLACEHOLDER);
    expect(body.questions).toEqual(DECISION_QUESTIONS_PLACEHOLDER);
  });

  it('state / questions 缺省退占位模板（保证复制出来就能跑）', () => {
    const body = buildDecisionBody({ modelId: MODEL });
    expect(body.state).toEqual(DECISION_STATE_PLACEHOLDER);
    expect(body.questions).toEqual(DECISION_QUESTIONS_PLACEHOLDER);
  });

  it('占位模板本身三原语齐全（示例要能展示这一面的全部形状）', () => {
    const types = Object.values(DECISION_QUESTIONS_PLACEHOLDER).map((q) => q.type);
    expect(types.sort()).toEqual([...DECISION_TYPES].sort());
  });
});

describe('7 门语言全量实装', () => {
  for (const lang of LANGS) {
    it(`${lang.id}：产物非空、打到 /v1/systemone、key 走环境变量`, () => {
      const code = generateDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: lang.id });
      expect(code.length).toBeGreaterThan(200);
      expect(code).toContain(`${BASE}${DECISION_PATH}`);
      expect(code).toContain(MODEL);
      // 七门语言一律从环境变量取 key，示例里不出字面量占位。
      expect(code).toContain('AIHUBMIX_API_KEY');
      expect(code).not.toContain('<AIHUBMIX_API_KEY>');
      expect(code).not.toContain('sk-');
    });
  }

  it('未知语言退 curl（与另三张表的降级一致）', () => {
    const unknown = generateDecisionCode({
      baseUrl: BASE,
      modelId: MODEL,
      // 消费端传来的语言 id 是运行时字符串，表里没有时不能返回空串。
      lang: 'kotlin' as never,
    });
    expect(unknown).toBe(generateDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: 'curl' }));
  });
});

// baseUrl 贯穿与「产物无中文」两条红线跟另两个面同表遍历，分别在
// tests/baseurl.test.ts、tests/output-language.test.ts 里 —— 加语言时只有一处要改。

describe('同源缝：Get Code 里的 body == buildDecisionBody 的输出', () => {
  it('curl 产物内嵌的 JSON 逐字等于 buildDecisionBody（消费端不许旁路拼 body）', () => {
    const opts = { baseUrl: BASE, modelId: MODEL, state: 'a message', questions: QUESTIONS };
    const code = generateDecisionCode({ ...opts, lang: 'curl' });
    // 取 -d '…' 里的那段，反解出对象再与 builder 比。字节级比会被 shell 转义干扰，
    // 这里比的是**语义等价**：同一份 body 两条路径产出同一个对象。
    const m = code.match(/-d '([\s\S]*)'$/);
    expect(m, '没取到 curl 的 -d 段').toBeTruthy();
    const embedded = JSON.parse(m![1].replace(/'\\''/g, "'"));
    expect(embedded).toEqual(buildDecisionBody(opts));
  });

  it('用户输入里的单引号不会截断 curl 命令（shellSafe 生效）', () => {
    const code = generateDecisionCode({
      baseUrl: BASE,
      modelId: MODEL,
      state: "it's broken",
      lang: 'curl',
    });
    const m = code.match(/-d '([\s\S]*)'$/);
    const embedded = JSON.parse(m![1].replace(/'\\''/g, "'"));
    expect(embedded.state).toBe("it's broken");
  });
});
