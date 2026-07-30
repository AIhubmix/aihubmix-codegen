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

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** 只允许出现在 src/config/** 的事实字面量。 */
const FACTS: { name: string; re: RegExp }[] = [
  { name: '网关域名', re: /aihubmix\.com/ },
  { name: 'API key 占位', re: /AIHUBMIX_API_KEY/ },
  { name: 'anthropic-version 值', re: /2023-06-01/ },
  { name: '协议路由', re: /['"`]\/v1\/(chat\/completions|messages|responses)/ },
  { name: 'gemini 路由', re: /\/gemini\/v1beta/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
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
