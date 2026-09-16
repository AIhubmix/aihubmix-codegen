/**
 * 事实只准住 config/ —— 防回归 lint。
 *
 * 抽 config 层之前，「网关根地址」「API key 占位」「anthropic-version」「协议路由」这几件事
 * 散在多个 renderer 里各写一份（鉴权 ternary ×5、anthropic-version ×5、BASE ×20、
 * AIHUBMIX_API_KEY ≈40）。抽完之后必须有一道门挡住「又在 renderer 里写死一次」，
 * 否则下次上游改版又要满仓翻。
 *
 * 只扫 src/，且豁免 src/config/**（事实就该住那儿）。注释里提到这些字符串是允许的
 * ——那是解释，不是事实来源——所以扫描前先去掉注释。
 * 已知限制：行尾内联注释（`code(); // …aihubmix.com`）不会被剥掉，会误报；
 * 现有代码没有这种写法，真出现了改成整行注释即可。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'scripts');

/** 只允许出现在 src/config/** 的事实字面量。 */
const FACTS: { name: string; re: RegExp }[] = [
  { name: '网关域名', re: /aihubmix\.com/ },
  { name: 'API key 占位', re: /AIHUBMIX_API_KEY/ },
  { name: 'anthropic-version 值', re: /2023-06-01/ },
  { name: '协议路由', re: /['"`]\/v1\/(chat\/completions|messages|responses)/ },
  { name: 'gemini 路由', re: /\/gemini\/v1beta/ },
  { name: 'realtime 路由', re: /['"`]\/v1\/realtime/ },
];

/**
 * 只走本仓自己的源码：跳过 node_modules 与点开头目录。
 *
 * 不跳会怎样：`verify:codegen` 会在 `scripts/.verify-runtime/` 里真装一份 openai /
 * @anthropic-ai/sdk 来跑生成的代码，那底下几十个文件当然写着 `/v1/messages`、
 * `2023-06-01` —— 全被判成「脚本里写死了网关事实」。这类目录都在 .gitignore 里，
 * 所以干净 checkout 的 CI 一直是绿的，**只有本地跑过验证的人会红**，是最难查的那种假红。
 */
function walk(dir: string, out: string[] = [], exts = ['.ts']): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, exts);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** 去掉块注释与整行 // 注释；字符串字面量原样保留（内联尾注释见文件头的已知限制）。 */
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

describe('事实只住 config/', () => {
  const files = walk(SRC).filter((f) => !relative(SRC, f).startsWith('config'));

  it('src/ 下（config/ 之外）不得出现硬编码的网关事实', () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      for (const fact of FACTS) {
        if (fact.re.test(code)) hits.push(`${relative(SRC, f)} → ${fact.name}`);
      }
    }
    expect(hits, `这些事实应改成 import config/ 里的常量：\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('扫描确实覆盖到了 renderer（防止 walk 写错导致空跑假绿）', () => {
    expect(files.some((f) => relative(SRC, f).startsWith('renderers'))).toBe(true);
    expect(files.length).toBeGreaterThan(15);
  });

  it('config/ 里确实有这些事实（否则说明扫描的正则和真源对不上了）', () => {
    const cfg = walk(join(SRC, 'config')).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const fact of FACTS) {
      // 网关域名是唯一例外：它已经彻底删掉，改由 ctx.baseUrl 注入，config 里只剩注释。
      if (fact.name === '网关域名') continue;
      expect(fact.re.test(cfg), `config/ 里找不到「${fact.name}」`).toBe(true);
    }
  });

  it('包里没有任何写死的 base：src/ 全域搜不到 aihubmix.com 的代码用法', () => {
    const all = walk(SRC).map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');
    expect(/aihubmix\.com/.test(all)).toBe(false);
  });
});

/**
 * 同一道门扩到 scripts/**。
 *
 * 为什么脚本也要管：verify-codegen.mjs 会把 base 直接注入 ctx.baseUrl 再**真发请求**，
 * 脚本里留一个默认域就等于多了一份真源 —— 它和 workflow 白名单一漂，就会出现
 * 「拿 A 域的 key 打 B 域」。域名只准在 workflow 的白名单里出现一次。
 *
 * 豁免不是「加进去就完事」：下面每条都带理由，且有一条测试反过来验它**仍然命中** ——
 * 豁免的前提消失（比如 snapshot 不再需要归一化）时，这里会红，逼着把豁免删掉。
 */
const SCRIPT_EXEMPTIONS: { file: string; fact: string; why: string }[] = [
  {
    file: 'snapshot.mjs',
    fact: '网关域名',
    why: '快照基线归一化：before 基线是「域名写死在 codegen 里」那个年代的产物，要把旧域替换成注入的 base 才比得了。是历史事实，不是当前默认值。',
  },
  {
    file: 'smoke-node.cjs',
    fact: '网关域名',
    why: '反向断言（assert 产物里**不含**该域），出现在这里恰恰是在防写死，删了就没人守这条。',
  },
  {
    file: 'verify-codegen.mjs',
    fact: 'API key 占位',
    why: '这是**验证器自己**读凭证的环境变量名，与生成代码里的 key 占位符是两回事（后者已改成 import API_KEY_PLACEHOLDER）。同名纯属就手。',
  },
];

describe('事实只住 config/ —— scripts/ 同门', () => {
  const files = walk(SCRIPTS, [], ['.mjs', '.cjs', '.js']);
  const hitsOf = (f: string) => {
    const code = stripComments(readFileSync(f, 'utf8'));
    return FACTS.filter((fact) => fact.re.test(code)).map((fact) => fact.name);
  };

  it('扫描确实覆盖到了 scripts（防止 walk 写错导致空跑假绿）', () => {
    expect(files.some((f) => f.endsWith('verify-codegen.mjs'))).toBe(true);
    expect(files.length).toBeGreaterThan(3);
  });

  it('scripts/ 下不得出现硬编码的网关事实（豁免见 SCRIPT_EXEMPTIONS）', () => {
    const allowed = new Set(SCRIPT_EXEMPTIONS.map((e) => `${e.file}/${e.fact}`));
    const bad: string[] = [];
    for (const f of files) {
      const name = relative(SCRIPTS, f);
      for (const fact of hitsOf(f)) {
        if (!allowed.has(`${name}/${fact}`)) bad.push(`${name} → ${fact}`);
      }
    }
    expect(bad, `脚本不该带这些事实（要么 import 包里的常量，要么由参数传入）：\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('豁免仍然名副其实：每条豁免都还命中，否则该删掉', () => {
    const stale = SCRIPT_EXEMPTIONS.filter(
      (e) => !hitsOf(join(SCRIPTS, e.file)).includes(e.fact),
    ).map((e) => `${e.file}/${e.fact}`);
    expect(stale, `这些豁免已经没有对应事实了，删掉：\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('verify 脚本的 key 占位符来自包，不是抄的字面量', () => {
    const src = readFileSync(join(SCRIPTS, 'verify-codegen.mjs'), 'utf8');
    expect(src).toMatch(/API_KEY_PLACEHOLDER/);
    // 占位符只准经 gen.API_KEY_PLACEHOLDER 用；出现 'AIHUBMIX_API_KEY' 字面量做替换就是抄了第二份。
    expect(stripComments(src)).not.toMatch(/replace(All)?\([^)]*AIHUBMIX_API_KEY/);
  });
});

/**
 * 剥掉字符串字面量，只留「会被执行的代码」。
 *
 * 必须区分**执行**与**产出**：renderers/typescript.ts 生成的 TS 示例里就写着
 * `process.env.AIHUBMIX_API_KEY` 和 `fetch(...)` —— 那是给用户跑的字节，不是包自己在跑。
 * 直接正则扫全文会把它们误报成「包碰了网络/环境变量」。
 *
 * 处理规则：'…' 与 "…" 整个抹掉；模板串抹掉文本段但**保留 `${}` 里的表达式**
 * （那部分是真代码）。已知限制：不认正则字面量里的引号 —— src/ 目前没有这种写法，
 * 下面 stripStringLiterals 自测那条测试会在写法变化时提醒。
 */
function stripStringLiterals(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  const skipQuoted = (q: string) => {
    i++; // 开引号
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') i++;
      i++;
    }
    i++; // 闭引号
  };
  while (i < n) {
    const c = src[i];
    if (c === "'" || c === '"') {
      skipQuoted(c);
      out += '""';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          const start = i;
          let depth = 1;
          while (i < n && depth > 0) {
            const ch = src[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (ch === "'" || ch === '"' || ch === '`') {
              skipQuoted(ch);
              continue;
            }
            if (depth > 0) i++;
          }
          out += ` ${src.slice(start, i)} `;
          i++; // 闭 }
          continue;
        }
        i++;
      }
      i++;
      out += '``';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

describe('isomorphic 约束', () => {
  // 包必须能在 node 里被 require（inferera-web 的 prerender-models.js 是消费方之一）。
  const BANNED = [
    { name: 'window', re: /\bwindow\./ },
    { name: 'document', re: /\bdocument\./ },
    { name: 'localStorage', re: /\blocalStorage\b/ },
    { name: 'fetch', re: /\bfetch\s*\(/ },
    { name: 'process.env', re: /\bprocess\.env\b/ },
    { name: 'react', re: /from ['"]react['"]/ },
  ];

  it('stripStringLiterals 自测：抹字符串、留 ${} 里的代码', () => {
    // 产出（在字符串里）→ 抹掉
    expect(stripStringLiterals('const t = `const k = process.env.X;`')).not.toContain('process.env');
    expect(stripStringLiterals(`const s = 'fetch(url)'`)).not.toContain('fetch(');
    expect(stripStringLiterals('const s = "a\\"process.env.X\\"b"')).not.toContain('process.env');
    // 执行（在代码里，含模板插值）→ 留下
    expect(stripStringLiterals('const k = process.env.X;')).toContain('process.env');
    expect(stripStringLiterals('const t = `key=${process.env.X}`;')).toContain('process.env');
    expect(stripStringLiterals('const t = `a${f(`b${fetch(u)}`)}c`;')).toContain('fetch(');
  });

  it('src/ 不碰 DOM / 网络 / 环境变量 / React', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const code = stripStringLiterals(stripComments(readFileSync(f, 'utf8')));
      for (const b of BANNED) if (b.re.test(code)) hits.push(`${relative(SRC, f)} → ${b.name}`);
    }
    expect(hits, `包必须 isomorphic：\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('剥字符串后代码骨架还在（防止 stripStringLiterals 把整份文件吃掉造成假绿）', () => {
    for (const f of walk(SRC)) {
      const stripped = stripStringLiterals(stripComments(readFileSync(f, 'utf8')));
      expect(stripped, relative(SRC, f)).toMatch(/\bexport\b/);
    }
  });
});
