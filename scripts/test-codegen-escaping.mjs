/**
 * test-codegen-escaping.mjs —— 各语言字符串转义的对抗回归测试（无网络 / 无 key）。
 *
 * 背景：verify-codegen 真跑各语言示例，但只用良性 prompt，抓不到「内容含特殊字符时生成代码被
 * 破坏/注入」。本测试用一段对抗内容（双引号 / 反斜杠 / Ruby `#{}` 插值 / 字面 true/false/null /
 * shell 元字符）生成各语言代码，做**真语法校验**：
 *   - python：ast.parse
 *   - ruby  ：ruby -c（含 messages 单引号 heredoc 安全性；chat/responses 双引号不得残留未转义 #{）
 *   - java  ：文本块内容按 Java 解转义规则(\\→\)还原后必须是合法 JSON（G1 回归）
 *   - 语义 ：pyLiteral 不得把字符串值里的 true 改成 True（G3 回归）
 *
 * 缺 python3/ruby 运行时的机器对应语言 skip，不阻塞。用法：node scripts/test-codegen-escaping.mjs
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 对抗内容：能逃逸字符串字面量 / 触发 Ruby 插值 / 混入布尔单词的各类字符。
const EVIL = 'say "hi" \\ path C:\\x and #{system("id")} and true false null $(whoami) `id`';
const ctx = {
  // 保留域（RFC 2606 的 .example TLD）：这个 harness 只做语法校验、从不真发请求，
  // 用真域名会让「不得在 scripts/ 里写死网关域」的门失效，也容易被误读成默认值。
  baseUrl: 'https://gateway.example',
  model: { id: 'gpt-5.5' },
  sys: 'Return true when valid #{x}',
  user: EVIL,
  p: { max_tokens: 16, temperature: 1 },
  stream: false, tools: null, think: false, thinkLevel: 'medium', structured: null,
  paramKeys: ['temperature', 'max_tokens'],
};

function has(cmd) {
  try { execFileSync('bash', ['-lc', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

const d = mkdtempSync(join(tmpdir(), 'cg-esc-'));
let fails = 0, skips = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { fails++; console.log(`FAIL ${name}: ${(e.message || e).toString().split('\n')[0].slice(0, 160)}`); }
}
function skip(name, why) { skips++; console.log(`SKIP ${name} (${why})`); }

(async () => {
  // esbuild 打包包入口（与 verify-codegen harness 同款：验源码，不验可能过期的 dist）
  const out = join(await mkdtemp(join(tmpdir(), 'cgb-')), 'codegen.mjs');
  await pexec('npx', ['esbuild', join(ROOT, 'src/index.ts'), '--bundle', '--format=esm',
    `--outfile=${out}`], { cwd: ROOT });
  const gen = await import(out);

  const pyOk = has('python3'), rbOk = has('ruby');

  for (const proto of ['chat', 'responses']) {
    if (!pyOk) { skip(`python ${proto}`, 'no python3'); continue; }
    check(`python ${proto} compiles`, () => {
      const f = join(d, `${proto}.py`); writeFileSync(f, gen.generateCode(proto, 'python', ctx));
      execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { stdio: 'ignore' });
    });
  }
  check('pyLiteral 不改字符串内 true', () => {
    if (/Return True when valid/.test(gen.generateCode('chat', 'python', ctx))) throw new Error('字符串内 true 被误改');
  });

  for (const proto of ['chat', 'messages', 'responses']) {
    if (!rbOk) { skip(`ruby ${proto}`, 'no ruby'); continue; }
    check(`ruby ${proto} syntax`, () => {
      const c = gen.generateCode(proto, 'ruby', ctx);
      const f = join(d, `${proto}.rb`); writeFileSync(f, c);
      execFileSync('ruby', ['-c', f], { stdio: 'ignore' });
      // messages 走单引号 heredoc(<<~'JSON')不插值,#{ 字面安全；chat/responses 双引号不得残留未转义 #{
      if (proto !== 'messages' && /[^\\]#\{/.test(c.replace(/\\#/g, ''))) throw new Error('双引号里残留未转义 #{');
    });
  }

  for (const proto of ['chat', 'messages', 'responses']) {
    check(`java ${proto} body 解转义后合法 JSON`, () => {
      const c = gen.generateCode(proto, 'java', ctx);
      const m = c.match(/String body = """\n([\s\S]*?)\n\s*""";/);
      if (!m) throw new Error('未找到 Java 文本块');
      const unescaped = m[1].replace(/\\\\/g, '\\'); // Java 文本块解转义:\\→\
      JSON.parse(unescaped.replace(/^\s+/gm, ''));
    });
  }

  console.log(`\n结果：${fails ? `${fails} FAIL` : '全部通过'}${skips ? `，${skips} skip` : ''}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('测试 harness 异常：', e); process.exit(2); });
