/**
 * 词汇隔离 —— 「这个包有没有自主判断的硬逻辑」的**机器判据**。
 *
 * 拆包之前，这个包同时说两种语言：
 *   - **wire 词汇**（该它管）：4 条路由、3 套鉴权头、body 里的键名与嵌套结构、7 门语言怎么
 *     把它写成代码。这是网关契约，**闭集** —— 4 个协议，上游改版才动。
 *   - **canon 词汇**（不该它管）：能力键（`reasoning-effort`）、verdict（`silent-degrade`）、
 *     canon 协议 id（`openai.chat_completions`）。这是知识库产物，**开集** —— canon 现有 64 个
 *     能力键，每周在长。
 *
 * 混着说的代价很具体：canon 加一条能力 → 改这个包 → 发版 → 两端升级。所以 canon 那一侧整体
 * 搬去了 @aihubmix/model-schema（它 import 本包，本包不 import 它，方向单向）。
 *
 * 下面三条把「搬干净了」从口头承诺变成编译期事实。**注释豁免**：解释性文字里提到这些词是
 * 允许的（本文件本身就全是），所以扫描前先去掉注释 —— 判据是「代码里有没有」，不是
 * 「文件里有没有」。
 *
 * ⚠️ 这不是穷举 canon 词表（64 个键这里只列了 11 个 + 几个高频未实现的）。它挡的是
 * **回归**：把搬走的东西又搬回来。真要新增 canon 词，第一反应就该是「这归 model-schema」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAP_GATED_WIRE_KEYS } from '../src/wire/capabilities.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * canon 的能力键。前 11 个是 model-schema 里 CAPABILITY_PUTS 覆盖的，
 * 后几个是 canon 有、包里从来没实现过的 —— 一并挡住，免得「新能力」直接写进这个包。
 */
const CANON_CAP_KEYS = [
  'system-instruction',
  'output-limit',
  'streaming',
  'reasoning-effort',
  'function-calling',
  'structured-output-json',
  'verbosity',
  'vision',
  'explicit-cache',
  'cache-routing-key',
  'background-mode',
  'audio-input',
  'code-execution',
  'web-search',
];

/** canon 对「字段在本网关是否生效」的结论标签。 */
const CANON_VERDICTS = [
  'tested-effective',
  'accepted-unverified',
  'silent-degrade',
  'rejected-or-unsupported',
  'not-applicable',
  'do-not-send',
  'official-model-level',
];

/** canon 投影里的协议全名（wire 上从不出现 —— 发给网关的 body 里没有这些字符串）。 */
const CANON_PROTO_IDS = [
  'openai.chat_completions',
  'openai.responses',
  'anthropic.messages',
  'google.gemini',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 去掉块注释与整行 // 注释（同 fact-localization：判据是代码，不是文件）。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

const FILES = walk(SRC);
const CODE: { file: string; code: string }[] = FILES.map((f) => ({
  file: relative(SRC, f),
  code: stripComments(readFileSync(f, 'utf8')),
}));

/**
 * 撞名豁免 —— canon 的能力键与 wire 的字段名偶尔同名，同名不等于同一件事。
 *
 * 每条都带理由，且下面有一条测试反过来验它**仍然命中**：撞名消失（比如 OpenAI 改名）时
 * 这里会红，逼着把豁免删掉，而不是留一个越来越宽的白名单。
 */
const COLLISION_EXEMPTIONS: { file: string; word: string; why: string }[] = [
  {
    file: 'config/wire-policy.ts',
    word: 'verbosity',
    why: 'OpenAI chat body 里真有一个叫 verbosity 的字段，这里是 Python SDK 原生 kwargs 白名单（不在名单里的键要塞进 extra_body）。是 wire 事实，与 canon 那个同名能力键无关 —— 本包不知道也不需要知道「这个模型的 verbosity 验没验过」。',
  },
  {
    file: 'renderers/go.ts',
    word: 'verbosity',
    why: '同上的撞名：go-openai 的 ChatCompletionRequest 有一个 Verbosity 字段，这里是 body 键 → struct 字段名的映射表。判据仍是「这个词有没有出现在发给网关的 body 里」—— verbosity 出现，所以它是 wire 词；reasoning-effort 那种带连字符的能力键不出现，才是 canon 词。',
  },
];

/** 命中的 (文件 → 词) 列表。词按**带引号的字面量**匹配：`reasoning_effort` 是 wire 键，不该误伤。 */
function rawHits(words: string[]): string[] {
  const out: string[] = [];
  for (const { file, code } of CODE) {
    for (const w of words) {
      if (code.includes(`'${w}'`) || code.includes(`"${w}"`) || code.includes(`\`${w}\``)) {
        out.push(`${file} → ${w}`);
      }
    }
  }
  return out;
}

const EXEMPT = new Set(COLLISION_EXEMPTIONS.map((e) => `${e.file} → ${e.word}`));
const hits = (words: string[]): string[] => rawHits(words).filter((h) => !EXEMPT.has(h));

describe('src/ 里不许出现 canon 词汇', () => {
  it('扫描确实覆盖到了 src（防止 walk 写错导致空跑假绿）', () => {
    expect(FILES.length).toBeGreaterThan(30);
    expect(CODE.some((c) => c.file.startsWith('wire'))).toBe(true);
    expect(CODE.some((c) => c.file.startsWith('renderers'))).toBe(true);
    expect(CODE.some((c) => c.file.startsWith('config'))).toBe(true);
  });

  it('hits() 自测：真放一个 canon 词进去要能被抓到（否则下面三条是空跑）', () => {
    // 用被测函数扫一个**必然存在**的 wire 词，证明匹配逻辑本身是活的。
    expect(hits(['chat']).length).toBeGreaterThan(0);
    // 反过来：编不出来的词一条都不该命中。
    expect(hits(['definitely-not-in-this-package'])).toEqual([]);
  });

  it('撞名豁免仍然名副其实：每条都还命中，否则该删掉', () => {
    const stale = COLLISION_EXEMPTIONS.filter(
      (e) => !rawHits([e.word]).includes(`${e.file} → ${e.word}`),
    ).map((e) => `${e.file} → ${e.word}`);
    expect(stale, `这些豁免已经没有对应字面量了，删掉：\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('无 canon 能力键字面量', () => {
    const bad = hits(CANON_CAP_KEYS);
    expect(bad, `能力键是 canon 的词、开集，归 @aihubmix/model-schema：\n  ${bad.join('\n  ')}`)
      .toEqual([]);
  });

  it('无 verdict 字面量', () => {
    const bad = hits(CANON_VERDICTS);
    expect(bad, `verdict 是 canon 的结论标签，本包不该对「验没验过」有任何判断：\n  ${bad.join('\n  ')}`)
      .toEqual([]);
  });

  it('无 canon 协议 id 字面量', () => {
    const bad = hits(CANON_PROTO_IDS);
    expect(bad, `canon 协议全名不出现在 wire 上，换算表归 model-schema：\n  ${bad.join('\n  ')}`)
      .toEqual([]);
  });

  it('公共入参类型 CodeGenCtx 通篇只有 wire 词', () => {
    // 验收项：消费端要传给本包的东西，不该逼它先懂 canon。
    // 只看类型声明本体（去注释后的 types.ts），能力键/verdict 一个都不许有。
    const types = CODE.find((c) => c.file === 'types.ts')!.code;
    for (const w of [...CANON_CAP_KEYS, ...CANON_VERDICTS, ...CANON_PROTO_IDS]) {
      expect(types.includes(w), `types.ts 出现 canon 词「${w}」`).toBe(false);
    }
  });
});

describe('CAP_GATED_WIRE_KEYS 仍由表自动导出', () => {
  it('等于 CAPABILITIES 各条 gatedKeys 的并集，不是手写的第二份', () => {
    // 原先这份集合两处手写，漏一边的表现是「关掉能力后残留值仍被发出」。
    // 这条锁住「自动导出」这个性质本身：改成手写常量、或漏掉某条能力的 gatedKeys，都会红。
    const expected = new Set(CAPABILITIES.flatMap((c) => c.gatedKeys));
    expect([...CAP_GATED_WIRE_KEYS].sort()).toEqual([...expected].sort());
    // 非空：真有能力接管了 wire 键，否则上面那条恒等式两边都是空集，等于没测。
    expect(CAP_GATED_WIRE_KEYS.size).toBeGreaterThan(0);
  });
});
