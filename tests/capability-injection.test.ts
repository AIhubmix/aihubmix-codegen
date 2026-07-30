/**
 * 能力注入层 —— 「勾几个能力 → 一段能跑的示例」。
 *
 * 最重要的一条是「每条 put 都真的落进 body」：apply() 改的是 ctx，body 由 buildBody 出，
 * 中间隔着 schema 门控、能力互斥、协议分支。没有这条测试，catalog 里写错一条 put 的表现是
 * 「报告说应用了、代码里其实没有」—— 静默假阳性，用户复制走一段不生效的代码才发现。
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_PUTS,
  generateFromCapabilities,
  type CapabilityResolver,
  type Verdict,
} from '../src/index.js';
import { LANGS } from '../src/config/languages.js';
import type { CodeLang, CodeProto } from '../src/types.js';

const BASE = 'https://aihubmix.com';
const MODEL = 'claude-opus-5';
const PROTOS: CodeProto[] = ['chat', 'messages', 'responses', 'gemini'];

/** 所有能力都按给定 verdict 命中（模拟 canon 全绿）。 */
const allWith = (verdict: Verdict): CapabilityResolver => () => ({ verdict });
/** canon 里什么都查不到。 */
const nothing: CapabilityResolver = () => null;

function gen(opts: {
  proto: CodeProto;
  caps: string[];
  resolve: CapabilityResolver;
  lang?: CodeLang;
}) {
  return generateFromCapabilities({
    model: MODEL,
    protocol: opts.proto,
    lang: opts.lang ?? 'python',
    capabilities: opts.caps,
    baseUrl: BASE,
    resolve: opts.resolve,
  });
}

describe('每条 put 都真的落进 body（landed 自校验）', () => {
  for (const def of CAPABILITY_PUTS) {
    for (const proto of Object.keys(def.put) as CodeProto[]) {
      it(`${def.key} × ${proto}`, () => {
        // 先决能力要一起勾（responses 的 verbosity 依赖结构化输出）
        const caps = [...(def.put[proto]!.requires ?? []), def.key];
        const r = gen({ proto, caps, resolve: allWith('tested-effective') });
        expect(r.used, `notes: ${JSON.stringify(r.notes)}`).toContain(def.key);
        expect(r.availability[def.key].applied).toBe(true);
        expect(r.code.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('无 canon 记录就不猜', () => {
  it('resolve 全 null → 一条都不可选、一条都不应用', () => {
    for (const proto of PROTOS) {
      const all = CAPABILITY_PUTS.map((c) => c.key);
      const r = gen({ proto, caps: all, resolve: nothing });
      expect(r.used, proto).toEqual([]);
      for (const st of Object.values(r.availability)) {
        expect(st.selectable, `${proto}/${st.cap}`).toBe(false);
        expect(st.reason).toBe('no-canon-entry');
        expect(st.applied).toBe(false);
      }
    }
  });

  it('body 里不出现任何能力字段（tools/reasoning/结构化/图片/缓存）', () => {
    for (const proto of PROTOS) {
      const r = gen({ proto, caps: CAPABILITY_PUTS.map((c) => c.key), resolve: nothing });
      const json = JSON.stringify(r.body);
      for (const key of ['tools', 'reasoning', 'thinking', 'response_format', 'output_config',
        'image_url', 'input_image', 'cache_control', 'prompt_cache_key', 'background', 'verbosity']) {
        expect(json.includes(`"${key}"`), `${proto} 泄漏了 ${key}: ${json}`).toBe(false);
      }
    }
  });
});

describe('availability 覆盖全表，不只覆盖勾选的那几条', () => {
  it('无论勾几个，availability 都有 11 条 —— UI 要渲染整行 chip', () => {
    const r = gen({ proto: 'chat', caps: ['streaming'], resolve: allWith('tested-effective') });
    expect(Object.keys(r.availability).sort()).toEqual(CAPABILITY_PUTS.map((c) => c.key).sort());
    expect(r.availability.streaming.requested).toBe(true);
    expect(r.availability.vision.requested).toBe(false);
    expect(r.availability.vision.selectable).toBe(true); // 可选但没勾
    expect(r.availability.vision.applied).toBe(false);
  });
});

describe('verdict 语义住在包里（UI 只映射 class）', () => {
  it('rejected-or-unsupported / do-not-send / not-applicable → 不可选、不应用', () => {
    for (const v of ['rejected-or-unsupported', 'do-not-send', 'not-applicable'] as Verdict[]) {
      const r = gen({ proto: 'chat', caps: ['reasoning-effort'], resolve: allWith(v) });
      expect(r.used, v).toEqual([]);
      expect(r.availability['reasoning-effort'].selectable).toBe(false);
      expect(r.availability['reasoning-effort'].level).toBe('unsupported');
      expect(r.notes.some((n) => n.cap === 'reasoning-effort' && n.code === 'verdict')).toBe(true);
      expect(JSON.stringify(r.body).includes('reasoning_effort')).toBe(false);
    }
  });

  it('accepted-unverified / unverified → 可选、照常应用，但带 info 提示', () => {
    for (const v of ['accepted-unverified', 'unverified'] as Verdict[]) {
      const r = gen({ proto: 'chat', caps: ['reasoning-effort'], resolve: allWith(v) });
      expect(r.used, v).toEqual(['reasoning-effort']);
      expect(r.availability['reasoning-effort'].level).toBe('unverified');
      const note = r.notes.find((n) => n.cap === 'reasoning-effort');
      expect(note?.level).toBe('info');
    }
  });

  it('词表外的 verdict 走 fail-open：可选 + 标未证实，不冒充已验证', () => {
    const r = gen({
      proto: 'chat',
      caps: ['reasoning-effort'],
      resolve: () => ({ verdict: 'brand-new-verdict' as Verdict }),
    });
    expect(r.used).toEqual(['reasoning-effort']);
    expect(r.availability['reasoning-effort'].level).toBe('unverified');
  });
});

describe('silent-degrade：警告必须进到用户复制走的代码里', () => {
  it('产 warn note 且代码顶部有对应语言的注释', () => {
    const r = gen({ proto: 'chat', caps: ['reasoning-effort'], resolve: allWith('silent-degrade') });
    expect(r.used).toEqual(['reasoning-effort']); // 仍然发，只是提醒可能不生效
    expect(r.availability['reasoning-effort'].level).toBe('degraded');
    expect(r.notes.some((n) => n.level === 'warn' && n.cap === 'reasoning-effort')).toBe(true);
    expect(r.code.startsWith('# WARNING: reasoning-effort:')).toBe(true);
  });

  it('注释符随语言走（go 是 //，不是 #）', () => {
    const r = gen({
      proto: 'chat',
      caps: ['reasoning-effort'],
      resolve: allWith('silent-degrade'),
      lang: 'go',
    });
    expect(r.code.startsWith('// WARNING: reasoning-effort:')).toBe(true);
  });

  it('没有 silent-degrade 时不插注释', () => {
    const r = gen({ proto: 'chat', caps: ['reasoning-effort'], resolve: allWith('tested-effective') });
    expect(r.code.includes('WARNING:')).toBe(false);
  });

  it('7 门语言都有注释符 —— 缺一个就会把警告写成语法错误', () => {
    for (const l of LANGS) expect(l.comment, l.id).toBeTruthy();
  });
});

describe('包里没有 put 的协议：显式报缺口，不静默漏', () => {
  it('gemini 的 streaming（是另一个端点，不是 body 字段）', () => {
    const r = gen({ proto: 'gemini', caps: ['streaming'], resolve: allWith('tested-effective') });
    expect(r.used).toEqual([]);
    expect(r.availability.streaming.selectable).toBe(false);
    expect(r.availability.streaming.reason).toBe('no-put-for-proto');
    const note = r.notes.find((n) => n.cap === 'streaming');
    expect(note?.level).toBe('warn');
    expect(note?.text).toContain('streamGenerateContent'); // 用的是 catalog 记的账，不是通用兜底
  });

  it('explicit-cache 在 chat/responses/gemini 上报缺口，在 messages 上正常落地', () => {
    for (const proto of ['chat', 'responses', 'gemini'] as CodeProto[]) {
      const r = gen({ proto, caps: ['explicit-cache'], resolve: allWith('tested-effective') });
      expect(r.availability['explicit-cache'].reason, proto).toBe('no-put-for-proto');
    }
    const ok = gen({ proto: 'messages', caps: ['explicit-cache'], resolve: allWith('tested-effective') });
    expect(ok.used).toEqual(['explicit-cache']);
    expect(JSON.stringify(ok.body)).toContain('cache_control');
  });
});

describe('协议必填字段：能力自己补齐，不产 400 的示例', () => {
  it('messages 的 thinking 必须带 budget_tokens，且 max_tokens 要大于它', () => {
    // Anthropic 要求 budget_tokens 必填、下限 1024、且 < max_tokens；只发 type 会 400。
    const r = gen({ proto: 'messages', caps: ['reasoning-effort'], resolve: allWith('tested-effective') });
    const thinking = r.body.thinking as Record<string, number | string>;
    expect(thinking.type).toBe('enabled');
    expect(thinking.budget_tokens).toBeGreaterThanOrEqual(1024);
    expect(r.body.max_tokens as number).toBeGreaterThan(thinking.budget_tokens as number);
  });

  it('与 output-limit 同勾时，抬 max_tokens 的那一步不会被覆盖回去', () => {
    const r = gen({
      proto: 'messages',
      caps: ['output-limit', 'reasoning-effort'],
      resolve: allWith('tested-effective'),
    });
    const thinking = r.body.thinking as Record<string, number>;
    expect(r.body.max_tokens as number).toBeGreaterThan(thinking.budget_tokens);
  });
});

describe('先决能力', () => {
  it('responses 的 verbosity 单勾 → 跳过 + warn（它是 text 组的子字段）', () => {
    const r = gen({ proto: 'responses', caps: ['verbosity'], resolve: allWith('tested-effective') });
    expect(r.used).toEqual([]);
    expect(r.availability.verbosity.reason).toBe('missing-prerequisite');
    expect(r.notes.some((n) => n.code === 'missing-prerequisite')).toBe(true);
    expect(JSON.stringify(r.body).includes('verbosity')).toBe(false);
  });

  it('与结构化输出同勾 → 落到 text.verbosity，且不覆盖 format', () => {
    const r = gen({
      proto: 'responses',
      caps: ['verbosity', 'structured-output-json'],
      resolve: allWith('tested-effective'),
    });
    expect(r.used.sort()).toEqual(['structured-output-json', 'verbosity']);
    const text = r.body.text as Record<string, unknown>;
    expect(text.verbosity).toBe('low');
    expect(text.format).toBeTruthy();
  });

  it('chat 的 verbosity 是扁平字段，不需要先决能力', () => {
    const r = gen({ proto: 'chat', caps: ['verbosity'], resolve: allWith('tested-effective') });
    expect(r.body.verbosity).toBe('low');
  });
});

describe('确定性与隔离', () => {
  it('capabilities 顺序不影响产物字节（应用顺序恒为表序）', () => {
    const caps = ['vision', 'function-calling', 'system-instruction', 'streaming'];
    const a = gen({ proto: 'chat', caps, resolve: allWith('tested-effective') });
    const b = gen({ proto: 'chat', caps: [...caps].reverse(), resolve: allWith('tested-effective') });
    expect(b.code).toBe(a.code);
    expect(b.used).toEqual(a.used);
  });

  it('两次调用互不串（ctx 每次新建，不是模块级可变状态）', () => {
    const withTools = gen({ proto: 'chat', caps: ['function-calling'], resolve: allWith('tested-effective') });
    const clean = gen({ proto: 'chat', caps: [], resolve: allWith('tested-effective') });
    expect(withTools.body.tools).toBeTruthy();
    expect('tools' in clean.body).toBe(false);
  });

  it('一个都不勾 → 只出协议必需字段（不夹带 temperature/top_p 这类无关参数）', () => {
    const r = gen({ proto: 'chat', caps: [], resolve: allWith('tested-effective') });
    expect(Object.keys(r.body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  });
});

describe('canon 的 field 只用于消歧与展示', () => {
  it('chat 的 output-limit：canon 把 max_completion_tokens 排在前面时按它发', () => {
    const r = generateFromCapabilities({
      model: 'gpt-5.6-sol',
      protocol: 'chat',
      lang: 'python',
      capabilities: ['output-limit'],
      baseUrl: BASE,
      resolve: () => ({ fields: ['max_completion_tokens', 'max_tokens'], verdict: 'tested-effective' }),
    });
    expect('max_completion_tokens' in r.body).toBe(true);
    expect('max_tokens' in r.body).toBe(false);
    expect(r.availability['output-limit'].fields).toEqual(['max_completion_tokens', 'max_tokens']);
  });

  it('field 是路径/模式（messages[].content[].type=image）也不会被当成 body 键', () => {
    const r = gen({
      proto: 'messages',
      caps: ['vision'],
      resolve: () => ({ field: 'messages[].content[].type=image', verdict: 'tested-effective' }),
    });
    expect(r.used).toEqual(['vision']);
    expect(JSON.stringify(r.body).includes('messages[]')).toBe(false);
  });
});

describe('未知能力 key', () => {
  it('报 unknown-capability，不静默丢', () => {
    const r = gen({ proto: 'chat', caps: ['teleportation'], resolve: allWith('tested-effective') });
    expect(r.notes.some((n) => n.code === 'unknown-capability' && n.cap === 'teleportation')).toBe(true);
    expect(r.availability.teleportation).toBeUndefined();
  });
});

describe('baseUrl 由调用方注入（双域构建）', () => {
  it('传 inferera 域则产物里不含 aihubmix.com', () => {
    const r = generateFromCapabilities({
      model: MODEL,
      protocol: 'messages',
      lang: 'curl',
      capabilities: ['streaming'],
      baseUrl: 'https://api.inferera.com',
      resolve: allWith('tested-effective'),
    });
    expect(r.code).toContain('https://api.inferera.com/v1/messages');
    expect(r.code.includes('aihubmix.com')).toBe(false);
  });
});

describe('body 与 code 同源', () => {
  it('返回的 body 就是生成这段代码用的那一个（可直接拿去发真实请求）', () => {
    const r = gen({ proto: 'chat', caps: ['function-calling'], resolve: allWith('tested-effective'), lang: 'curl' });
    expect(r.body.model).toBe(MODEL);
    // curl 是原生 REST，body 逐字出现在代码里
    expect(r.code).toContain('"get_weather"');
    expect(r.code).toContain(MODEL);
  });
});
