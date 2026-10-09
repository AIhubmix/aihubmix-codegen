/**
 * OpenAI Decisions（POST /v1/decisions）面：body 形状、空值判据、同源缝、7 门语言产出，
 * 以及与 /v1/systemone 那一面互不串味。
 *
 * 与 tests/decision.test.ts 平行而不合并：两个端点的 body 形状、题型名、答案形状都不同，
 * 合成一份测试只会让断言为了兼容两边而变弱。
 */
import { describe, expect, it } from 'vitest';
import {
  buildOpenAIDecisionBody,
  generateDecisionCode,
  generateOpenAIDecisionCode,
  LANGS,
  OPENAI_DECISION_INPUT_PLACEHOLDER,
  OPENAI_DECISION_PATH,
  OPENAI_DECISION_QUESTIONS_PLACEHOLDER,
  OPENAI_DECISION_SDK,
  OPENAI_DECISION_TYPES,
  type OpenAIDecisionMessage,
  type OpenAIDecisionQuestion,
} from '../src/index.js';
import { DECISION_PATH } from '../src/config/decision.js';
import { jsLiteral, pyLiteral } from '../src/emit/literal.js';

const BASE = 'https://aihubmix.com';
const MODEL = 'gpt-6-luna';

/** 三种题型混问的真实形态（对照 2026-10-09 网关实测 200 的那次调用，改写为英文）。 */
const QUESTIONS: OpenAIDecisionQuestion[] = [
  { type: 'predicate', name: 'is_billing_issue', instructions: 'Is this about billing?' },
  {
    type: 'choice',
    name: 'department',
    instructions: 'Which team should handle this?',
    choices: [
      { value: 'billing', description: 'Payments and refunds.' },
      { value: 'technical' },
    ],
  },
  {
    type: 'score',
    name: 'urgency',
    instructions: 'How urgent is this?',
    levels: [{ label: 'low' }, { label: 'medium' }, { label: 'high', description: 'Money lost.' }],
  },
];

/** SDK 型单元格（python / javascript）不出现完整端点 URL，只出现 base + `/v1`。 */
const SDK_LANGS = new Set(Object.keys(OPENAI_DECISION_SDK));

describe('buildOpenAIDecisionBody：请求体形状', () => {
  it('三个键，顺序固定 model / input / questions（没有 stream —— 上游请求体不收多余字段）', () => {
    const body = buildOpenAIDecisionBody({ modelId: MODEL, input: 'hello', questions: QUESTIONS });
    expect(Object.keys(body)).toEqual(['model', 'input', 'questions']);
    expect(body.model).toBe(MODEL);
    expect(body.input).toBe('hello');
  });

  it('input 收字符串，也收 user 消息数组（含 input_image 片段），原样下发', () => {
    const messages: OpenAIDecisionMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Check this image.' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'low' },
        ],
      },
    ];
    expect(buildOpenAIDecisionBody({ modelId: MODEL, input: messages }).input).toEqual(messages);
  });

  it('questions 是有序数组：顺序与 type 原样保留（答案按同一顺序回来，判别器不许被改写）', () => {
    const qs = buildOpenAIDecisionBody({ modelId: MODEL, questions: QUESTIONS })
      .questions as OpenAIDecisionQuestion[];
    expect(Array.isArray(qs)).toBe(true);
    expect(qs.map((q) => q.name)).toEqual(['is_billing_issue', 'department', 'urgency']);
    expect(qs.map((q) => q.type)).toEqual(['predicate', 'choice', 'score']);
    expect(qs[1].choices).toEqual(QUESTIONS[1].choices);
    expect(qs[2].levels).toEqual(QUESTIONS[2].levels);
  });

  it('单题键序固定 type / name / instructions / choices / levels（与实测请求同序）', () => {
    const [q] = buildOpenAIDecisionBody({
      modelId: MODEL,
      questions: [{ levels: [{ label: 'a' }, { label: 'b' }], instructions: 'x', name: 'n', type: 'score' }],
    }).questions as OpenAIDecisionQuestion[];
    expect(Object.keys(q)).toEqual(['type', 'name', 'instructions', 'levels']);
  });

  it('OPENAI_DECISION_TYPES 就是占位模板里真出现的那三个 type', () => {
    expect(OPENAI_DECISION_QUESTIONS_PLACEHOLDER.map((q) => q.type).sort()).toEqual(
      [...OPENAI_DECISION_TYPES].sort(),
    );
  });
});

describe('空值判据：可选字段空值不下发，必填字段只在没提供时不下发', () => {
  it('可选的 name：空串 / undefined 都不进 body（表单留空 = 不命名）', () => {
    const qs = buildOpenAIDecisionBody({
      modelId: MODEL,
      questions: [
        { type: 'predicate', name: '', instructions: 'a' },
        { type: 'predicate', name: undefined, instructions: 'b' },
      ],
    }).questions as OpenAIDecisionQuestion[];
    expect(qs).toStrictEqual([
      { type: 'predicate', instructions: 'a' },
      { type: 'predicate', instructions: 'b' },
    ]);
  });

  it('必填的 instructions / choices / levels：空串、空数组原样下发（spec 允许空串，条数下限交给上游判）', () => {
    const qs = buildOpenAIDecisionBody({
      modelId: MODEL,
      questions: [
        { type: 'predicate', instructions: '' },
        { type: 'choice', instructions: 'pick', choices: [] },
        { type: 'score', instructions: 'rate', levels: [] },
      ],
    }).questions as OpenAIDecisionQuestion[];
    expect(qs).toStrictEqual([
      { type: 'predicate', instructions: '' },
      { type: 'choice', instructions: 'pick', choices: [] },
      { type: 'score', instructions: 'rate', levels: [] },
    ]);
  });

  it('必填字段没提供（undefined）时不下发 —— 包不替调用方编内容，缺了由上游 400 说明', () => {
    const [q] = buildOpenAIDecisionBody({
      modelId: MODEL,
      questions: [{ type: 'choice', instructions: undefined, choices: undefined }],
    }).questions as OpenAIDecisionQuestion[];
    expect(q).toStrictEqual({ type: 'choice' });
  });

  it('嵌套的 undefined 被归一掉：body 即发上线的 JSON 形态，SDK 两格不会把它写成 None / null', () => {
    const opts = {
      baseUrl: BASE,
      modelId: MODEL,
      questions: [
        {
          type: 'choice' as const,
          name: 'c',
          instructions: 'pick',
          choices: [{ value: 'a', description: undefined }, { value: 'b' }],
        },
      ],
    };
    const body = buildOpenAIDecisionBody(opts);
    expect(body).toStrictEqual(JSON.parse(JSON.stringify(body)));
    expect((body.questions as OpenAIDecisionQuestion[])[0].choices![0]).toStrictEqual({ value: 'a' });
    // 只看 create(...) 的参数段：说明注释里本来就写着「null if unnamed」。
    const callArgs = (code: string) => code.slice(code.indexOf('decisions.create('), code.indexOf('for '));
    expect(callArgs(generateOpenAIDecisionCode({ ...opts, lang: 'python' }))).not.toContain('None');
    expect(callArgs(generateOpenAIDecisionCode({ ...opts, lang: 'javascript' }))).not.toMatch(/\bnull\b/);
  });

  it('返回的 body 不与占位模板常量共享引用（消费端改 body 不会污染下一次生成）', () => {
    const body = buildOpenAIDecisionBody({ modelId: MODEL });
    (body.questions as OpenAIDecisionQuestion[])[1].choices!.push({ value: 'mutated' });
    expect(JSON.stringify(OPENAI_DECISION_QUESTIONS_PLACEHOLDER)).not.toContain('mutated');
  });

  it('input 类型接受 spec 允许的 detail: null 与显式 type: "message"', () => {
    // 这条主要是**编译期**断言（tests 在 tsconfig 的 include 里，typecheck 会检查这个字面量）。
    const messages: OpenAIDecisionMessage[] = [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: null }],
      },
    ];
    expect(buildOpenAIDecisionBody({ modelId: MODEL, input: messages }).input).toStrictEqual(messages);
  });

  it('布尔选项值 false 不是「没填」（上游支持布尔选项，答案保持布尔类型）', () => {
    const [q] = buildOpenAIDecisionBody({
      modelId: MODEL,
      questions: [
        { type: 'choice', instructions: 'Does it apply?', choices: [{ value: true }, { value: false }] },
      ],
    }).questions as OpenAIDecisionQuestion[];
    expect(q.choices).toEqual([{ value: true }, { value: false }]);
  });

  it('input / questions 缺省或为空时退占位模板（保证复制出来就能跑）', () => {
    for (const empty of [{}, { input: '', questions: [] }, { input: [] as OpenAIDecisionMessage[] }]) {
      const body = buildOpenAIDecisionBody({ modelId: MODEL, ...empty });
      expect(body.input).toBe(OPENAI_DECISION_INPUT_PLACEHOLDER);
      expect(body.questions).toEqual(OPENAI_DECISION_QUESTIONS_PLACEHOLDER);
    }
  });

  it('占位模板满足上游的硬约束（choice 2–255 项、score 2–10 档、每题都有 instructions）', () => {
    for (const q of OPENAI_DECISION_QUESTIONS_PLACEHOLDER) {
      expect(q.instructions, `${q.name} 缺 instructions`).toBeTruthy();
      if (q.type === 'choice') expect(q.choices!.length).toBeGreaterThanOrEqual(2);
      if (q.type === 'score') {
        expect(q.levels!.length).toBeGreaterThanOrEqual(2);
        expect(q.levels!.length).toBeLessThanOrEqual(10);
      }
    }
  });

  it('占位 input 不含单引号（否则 cURL 默认示例要渲染成难读的 \'\\\'\'）', () => {
    expect(OPENAI_DECISION_INPUT_PLACEHOLDER).not.toContain("'");
    expect(JSON.stringify(OPENAI_DECISION_QUESTIONS_PLACEHOLDER)).not.toContain("'");
  });
});

describe('7 门语言全量实装', () => {
  for (const lang of LANGS) {
    it(`${lang.id}：产物非空、打到 /v1/decisions、key 走环境变量、四种答案都有分支或说明`, () => {
      const code = generateOpenAIDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: lang.id });
      expect(code.length).toBeGreaterThan(200);
      if (SDK_LANGS.has(lang.id)) {
        const sdk = OPENAI_DECISION_SDK[lang.id as keyof typeof OPENAI_DECISION_SDK];
        expect(code).toContain(`"${BASE}${sdk.baseSuffix}"`);
        expect(code).toContain(`${sdk.call}(`);
        // 版本下限必须跟着代码走：旧 SDK 上 client.decisions 不存在。
        expect(code.split('\n')[0]).toContain(sdk.install);
      } else {
        expect(code).toContain(`${BASE}${OPENAI_DECISION_PATH}`);
      }
      expect(code).toContain(MODEL);
      // 七门语言一律从环境变量取 key，示例里不出字面量占位。
      expect(code).toContain('AIHUBMIX_API_KEY');
      expect(code).not.toContain('<AIHUBMIX_API_KEY>');
      expect(code).not.toContain('sk-');
      for (const kind of [...OPENAI_DECISION_TYPES, 'refusal']) expect(code).toContain(kind);
    });
  }

  it('SDK 的 base 后缀 + 资源路径拼起来正好是端点路径（SDK 请求 {base_url}/decisions）', () => {
    for (const sdk of Object.values(OPENAI_DECISION_SDK)) {
      expect(`${sdk.baseSuffix}/decisions`).toBe(OPENAI_DECISION_PATH);
    }
  });

  it('未知语言退 curl（与另几张表的降级一致）', () => {
    const unknown = generateOpenAIDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: 'kotlin' as never });
    expect(unknown).toBe(generateOpenAIDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: 'curl' }));
  });
});

describe('同源缝：Get Code 里的 body == buildOpenAIDecisionBody 的输出', () => {
  const opts = { baseUrl: BASE, modelId: MODEL, input: 'a message', questions: QUESTIONS };

  it('curl 产物内嵌的 JSON 等于 buildOpenAIDecisionBody（消费端不许旁路拼 body）', () => {
    const code = generateOpenAIDecisionCode({ ...opts, lang: 'curl' });
    const m = code.match(/-d '([\s\S]*)'$/);
    expect(m, '没取到 curl 的 -d 段').toBeTruthy();
    expect(JSON.parse(m![1].replace(/'\\''/g, "'"))).toEqual(buildOpenAIDecisionBody(opts));
  });

  it('python SDK 调用：body 的每个键逐个渲染成同名关键字参数，值即 pyLiteral(body 值)', () => {
    const code = generateOpenAIDecisionCode({ ...opts, lang: 'python' });
    for (const [k, v] of Object.entries(buildOpenAIDecisionBody(opts))) {
      expect(code, `缺关键字参数 ${k}`).toContain(`    ${k}=${pyLiteral(v, '    ')},`);
    }
  });

  it('TypeScript SDK 调用：传入的对象字面量即 jsLiteral(body)', () => {
    const code = generateOpenAIDecisionCode({ ...opts, lang: 'javascript' });
    expect(code).toContain(`${OPENAI_DECISION_SDK.javascript.call}(${jsLiteral(buildOpenAIDecisionBody(opts), '')});`);
  });

  it('TypeScript SDK 调用的对象字面量**求值后**严格等于 curl 发出去的 JSON（不借用同一个渲染函数比）', () => {
    const tricky = {
      ...opts,
      questions: [
        ...QUESTIONS,
        { type: 'choice' as const, instructions: 'x', choices: [{ value: false, description: undefined }, { value: true }] },
      ],
    };
    const ts = generateOpenAIDecisionCode({ ...tricky, lang: 'javascript' });
    const lit = ts.match(/client\.decisions\.create\((\{[\s\S]*?\n\})\);/);
    expect(lit, '没取到 create(...) 的对象字面量').toBeTruthy();
    // eslint-disable-next-line no-new-func
    const evaluated = new Function(`return (${lit![1]});`)();
    const curl = generateOpenAIDecisionCode({ ...tricky, lang: 'curl' }).match(/-d '([\s\S]*)'$/);
    expect(evaluated).toStrictEqual(JSON.parse(curl![1].replace(/'\\''/g, "'")));
  });

  it('用户输入里的单引号不会截断 curl 命令（shellSafe 生效）', () => {
    const code = generateOpenAIDecisionCode({ ...opts, input: "it's broken", lang: 'curl' });
    const m = code.match(/-d '([\s\S]*)'$/);
    expect(JSON.parse(m![1].replace(/'\\''/g, "'")).input).toBe("it's broken");
  });
});

describe('两个 decision 面互不串味', () => {
  for (const lang of LANGS) {
    it(`${lang.id}：/v1/decisions 产物里没有 /v1/systemone 的词，反之亦然`, () => {
      const openai = generateOpenAIDecisionCode({ baseUrl: BASE, modelId: MODEL, lang: lang.id });
      expect(openai).not.toContain(DECISION_PATH);
      expect(openai).not.toMatch(/\bnoul\b|"state"|\bstate:|\bcriteria\b/);
      const systemone = generateDecisionCode({ baseUrl: BASE, modelId: 'jev-1.13', lang: lang.id });
      expect(systemone).not.toContain(OPENAI_DECISION_PATH);
      expect(systemone).not.toMatch(/\bpredicate\b|client\.decisions/);
    });
  }
});
