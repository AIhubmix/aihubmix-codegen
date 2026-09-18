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

  // ── 媒体侧（generateMediaCode）────────────────────────────────────
  // 上面那批只测 generateCode（LLM 半边）。媒体半边一条覆盖都没有 —— mediaVideoJava 里
  // `contains("\"completed\"")` 在 JS 模板字符串里塌成 `contains(""completed"")`（编译不过）
  // 就是这么溜出去的：测试不覆盖、生成物没人拿去编译。
  const mediaCtx = (modality, lang) => ({ modality, modelId: 'sora-2', prompt: EVIL, params: { seconds: 8 }, lang });
  /** 剥掉 body 文本块：里面是 EVIL prompt 带来的数据，反斜杠/引号本就该有，单独验合法 JSON。 */
  const javaCodeOnly = (c) => c.replace(/String body = """\n[\s\S]*?\n\s*""";/, '');

  for (const modality of ['image', 'video']) {
    check(`java media-${modality} body 解转义后合法 JSON`, () => {
      const c = gen.generateMediaCode(mediaCtx(modality, 'java'));
      const m = c.match(/String body = """\n([\s\S]*?)\n\s*""";/);
      if (!m) throw new Error('未找到 Java 文本块');
      JSON.parse(m[1].replace(/\\\\/g, '\\').replace(/^\s+/gm, ''));
    });

    // 红线：Java 产物的**代码部分**不许出现反斜杠。
    // 生成 Java 的模板本身是 JS 模板字符串，写 `\"` 会在 JS 这一层就被吃掉一层，
    // 想发出 Java 的 `\"` 得写 `\\"`、想发出正则 `\s` 得写 `\\\\s` —— 这种双层转义
    // 人眼几乎校不出来。所以干脆立规矩：Java 侧用 `String.valueOf('"')`（Java 字符
    // 字面量里的引号无需转义）和 ` *` 拼，一个反斜杠都不写。
    // 例外只有 body 文本块：EVIL prompt 里本来就带反斜杠，那是数据不是代码，上面单独验。
    check(`java media-${modality} 代码部分无反斜杠`, () => {
      const c = gen.generateMediaCode(mediaCtx(modality, 'java'));
      const bad = javaCodeOnly(c).split('\n').filter((l) => l.includes('\\'));
      if (bad.length) throw new Error(`出现反斜杠(双层转义陷阱)：${bad.join(' | ')}`);
    });

    // 上面那条是**预防**，这条是**检测**，两条覆盖塌陷的两半：
    //   · `\\s` 塌成 `\s`（反斜杠还在一个）→ 上面那条抓；
    //   · `\"`  塌成 `"`（反斜杠没了）→ 上面那条抓不到，得靠这条。
    // `contains("\"completed\"")` 塌成 `contains(""completed"")`，指纹是 `""` **紧贴单词字符**。
    // 单纯的 `""`（空字符串字面量，如 `field()` 匹配不到时的返回值）是合法的，不能一刀切。
    check(`java media-${modality} 无紧贴单词的双引号对（转义塌陷指纹）`, () => {
      const c = gen.generateMediaCode(mediaCtx(modality, 'java'));
      const bad = javaCodeOnly(c).split('\n').filter((l) => /\w""|""\w/.test(l));
      if (bad.length) throw new Error(`出现 ""：多半是 \\" 在 JS 模板里塌了一层：${bad.join(' | ')}`);
    });
  }

  // 轮询终态判断要读 status 字段，不能拿整个响应体做子串匹配 ——
  // prompt 或 error 文案里出现 "completed" 就会让循环提前跳出。其它 5 门语言都是读字段。
  check('java media-video 按 status 字段判终态，不用 contains 扫全文', () => {
    const c = gen.generateMediaCode(mediaCtx('video', 'java'));
    if (/pollBody\.contains\(/.test(c)) throw new Error('还在用 contains 扫全文');
    if (!/status\.equals\("completed"\)/.test(c)) throw new Error('未按 status 字段判 completed');
  });

  // 其余语言的媒体产物同样过一遍真语法校验（此前也没跑过）
  for (const modality of ['image', 'video']) {
    if (!pyOk) { skip(`python media-${modality}`, 'no python3'); }
    else check(`python media-${modality} compiles`, () => {
      const f = join(d, `m-${modality}.py`); writeFileSync(f, gen.generateMediaCode(mediaCtx(modality, 'python')));
      execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { stdio: 'ignore' });
    });

    if (!rbOk) { skip(`ruby media-${modality}`, 'no ruby'); }
    else check(`ruby media-${modality} syntax`, () => {
      const f = join(d, `m-${modality}.rb`); writeFileSync(f, gen.generateMediaCode(mediaCtx(modality, 'ruby')));
      execFileSync('ruby', ['-c', f], { stdio: 'ignore' });
    });
  }

  // realtime 半边：EVIL 经 prompt/keywords 注入 session.update（自由文本 → 转义面），过真语法校验
  const rtOpts = (lang) => ({
    baseUrl: 'https://api.inferera.com', modelId: 'gpt-live-transcribe',
    prompt: EVIL, keywords: [EVIL], languages: ['en'], lang,
  });
  if (!pyOk) { skip('python realtime', 'no python3'); }
  else check('python realtime compiles', () => {
    const f = join(d, 'rt.py'); writeFileSync(f, gen.generateRealtimeCode(rtOpts('python')));
    execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { stdio: 'ignore' });
  });
  check('javascript realtime node --check 通过', () => {
    const f = join(d, 'rt.mjs'); writeFileSync(f, gen.generateRealtimeCode(rtOpts('javascript')));
    execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' });
  });

  // realtime 对话半边：EVIL 经 instructions/voice（自由文本 → 转义面）注入 session.update，过真语法校验
  const convOpts = (lang) => ({
    kind: 'conversation', baseUrl: 'https://api.inferera.com', modelId: 'gpt-realtime-2.1',
    instructions: EVIL, voice: EVIL, lang,
  });
  if (!pyOk) { skip('python realtime conversation', 'no python3'); }
  else check('python realtime conversation compiles', () => {
    const f = join(d, 'rt-conv.py'); writeFileSync(f, gen.generateRealtimeCode(convOpts('python')));
    execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f], { stdio: 'ignore' });
  });
  check('javascript realtime conversation node --check 通过', () => {
    const f = join(d, 'rt-conv.mjs'); writeFileSync(f, gen.generateRealtimeCode(convOpts('javascript')));
    execFileSync(process.execPath, ['--check', f], { stdio: 'ignore' });
  });

  console.log(`\n结果：${fails ? `${fails} FAIL` : '全部通过'}${skips ? `，${skips} skip` : ''}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('测试 harness 异常：', e); process.exit(2); });
