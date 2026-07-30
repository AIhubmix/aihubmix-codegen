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

  // go chat 是唯一「强类型 struct 逐字段渲染」的单元格：tools / response_format 是嵌套结构体，
  // schema JSON 塞在 Go raw string（反引号）里 —— 对抗内容里正好有反引号。语法校验挡不住类型
  // 错误，所以这里直接 go build。缺 go 或拉不到 module（离线）时 skip，不阻塞。
  if (!has('go')) {
    skip('go chat compiles', 'no go');
  } else {
    let goDir = null;
    try {
      goDir = mkdtempSync(join(tmpdir(), 'cg-go-'));
      execFileSync('go', ['mod', 'init', 'esccheck'], { cwd: goDir, stdio: 'ignore' });
      execFileSync('go', ['get', 'github.com/sashabaranov/go-openai@latest'], {
        cwd: goDir, stdio: 'ignore', env: { ...process.env, GOFLAGS: '-mod=mod' },
      });
    } catch {
      goDir = null;
      skip('go chat compiles', 'go module 拉取失败（离线？）');
    }
    if (goDir) {
      // 两个模型 id 各编一次。go-openai 的 ReasoningValidator 按**模型 id 前缀**
      // （o1/o3/o4/gpt-5）拦参数，渲染器因此分了两条路：命中的走 MaxCompletionTokens
      // 且让掉 temperature/top_p/n/penalty/logprobs 并补一段注释，没命中的照常全渲染。
      // 只编一个 id 等于只编一条路 —— 上面那个 ctx 恰好是 gpt-5.5，非 reasoning 那条
      // （今天绝大多数模型走的路）一直没被编译验证过。
      for (const [label, modelId] of [['reasoning(gpt-5)', 'gpt-5.5'], ['普通模型', 'gpt-4o']]) {
        check(`go chat compiles / ${label}（含 tools / response_format 嵌套 struct）`, () => {
          // 用带 tools + structured 的 ctx：不带它们等于没测到新增的那两段渲染。
          const rich = {
            ...ctx,
            model: { id: modelId },
            // EVIL 进到 schema **内部**：那段 JSON 是嵌进 Go raw string（反引号）的，而 EVIL 里
            // 正好带一个反引号 —— 不经 goRawSafe 就会当场截断 raw string，编译失败。
            tools: [{ name: 'evil_tool', description: EVIL, parameters: JSON.stringify({ type: 'object', properties: { q: { type: 'string', description: EVIL } } }) }],
            structured: { format: 'json_schema', name: 'answer', schema: JSON.stringify({ type: 'object', properties: { a: { type: 'string', description: EVIL } } }) },
            // tool_choice 走 json.RawMessage（字段类型是 any），工具名里带反引号同样能截断 raw string。
            toolChoice: { mode: 'tool', name: EVIL },
            objects: { stop: [EVIL] },
            // 这几个数值参数正是 ReasoningValidator 的拦截名单：普通模型下要渲染成 struct 字段，
            // reasoning 模型下要整批消失并被注释点名。两条路都得编得过。
            p: { ...ctx.p, temperature: 0.7, top_p: 0.9, n: 2, frequency_penalty: 0.5, presence_penalty: 0.3, top_logprobs: 3 },
            paramKeys: [...ctx.paramKeys, 'top_p', 'n', 'frequency_penalty', 'presence_penalty',
              'top_logprobs', 'tools', 'tool_choice', 'response_format', 'stop'],
          };
          writeFileSync(join(goDir, 'main.go'), gen.generateCode('chat', 'go', rich));
          execFileSync('go', ['build', '-o', join(goDir, 'out.bin'), '.'], { cwd: goDir, stdio: 'pipe' });
        });
      }
    }
  }

  console.log(`\n结果：${fails ? `${fails} FAIL` : '全部通过'}${skips ? `，${skips} skip` : ''}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('测试 harness 异常：', e); process.exit(2); });
