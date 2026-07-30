/**
 * verify-codegen.mjs —— 代码示例真实运行验证 harness。
 *
 * 目的：对某模型，把「Get Code」会生成的 每个 协议 × 语言 示例真实跑一遍，
 * 确保给用户的代码示例「完全正确」（能编译/运行 + 网关返回成功）。
 *
 * 被测物是本仓 src/（包本身）。原先住在 playground（被测物是 src/lib/codegen.ts），
 * codegen 包化之后包仓才是真值所在，所以脚本与 workflow 一起迁到这里 —— 放别处需要复制
 * codegen，真值分叉。
 *
 * 语言清单来自 config/languages.ts（唯一真源，不再自己抄一份）：
 *   curl / python / javascript(node) / go / java / csharp / ruby
 * 协议清单来自 config/protocols.ts：chat / messages / responses / gemini。
 *
 * 运行时按「探测得到才跑、否则 skip」：
 *   - go     ：本机 go + 自建 module（拉 sashabaranov/go-openai）→ scripts/.verify-runtime-go/
 *   - java   ：本机 JDK 11+（java Main.java 单文件源码模式，零依赖）
 *   - csharp ：本机 dotnet SDK（临时 .csproj + dotnet run）
 *   - ruby   ：本机 ruby + ruby-openai gem（chat/responses）→ scripts/.verify-runtime-ruby/；
 *              messages 走原生 net/http（ruby-anthropic 不支持自定义 base，无需 gem）
 * 缺运行时/装不上的组合标 skip，不阻塞整体结果。
 *
 * 用法：
 *   VERIFY_API_KEY=sk-xxx node scripts/verify-codegen.mjs [--model gpt-5.5] [--base https://…] [--stream]
 *
 * 凭证：环境变量 VERIFY_API_KEY（真实打网关，会产生真实调用/计费）。
 * node 运行时：openai / @anthropic-ai/sdk 首次自动装到 scripts/.verify-runtime/（已 gitignore）。
 *
 * ⚠️ dev/QA 工具：不被 src 任何代码 import，不进构建产物，仅 pnpm verify:codegen 手动跑。
 */
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, 'scripts', '.verify-runtime');
const RUNTIME_GO = join(ROOT, 'scripts', '.verify-runtime-go');
const RUNTIME_RUBY = join(ROOT, 'scripts', '.verify-runtime-ruby');

// 本地运行时路径兜底：brew 的 openjdk/ruby 是 keg-only（不在默认 PATH），dotnet 需 DOTNET_ROOT。
// 存在则自动补进环境，免去每次手动 export，使 `pnpm verify:codegen` 开箱即跑。
for (const p of ['/opt/homebrew/opt/openjdk/bin', '/opt/homebrew/opt/ruby/bin']) {
  if (existsSync(p) && !(process.env.PATH || '').split(':').includes(p)) {
    process.env.PATH = `${p}:${process.env.PATH || ''}`;
  }
}
if (!process.env.DOTNET_ROOT && existsSync('/opt/homebrew/opt/dotnet/libexec')) {
  process.env.DOTNET_ROOT = '/opt/homebrew/opt/dotnet/libexec';
}

// ---- args ----
const args = process.argv.slice(2);
const model = argVal('--model') || 'gpt-5.5';
const stream = args.includes('--stream');
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// model 会嵌入并**真实运行**各语言示例源码——含引号/反斜杠/`#{}`/`$()` 等可逃逸字符串字面量、
// 在 CI runner 上形成代码注入(RCE)。入口只放模型 id 合法字符,其余一律拒绝。
if (!/^[A-Za-z0-9._:\/-]+$/.test(model)) {
  console.error(`✗ 非法 model id: ${JSON.stringify(model)}（只允许字母数字与 . _ : / -）。`);
  process.exit(2);
}

// 作为入口直接运行才跑主流程/校验凭证;被 import(单测 classify)时零副作用。
const isMain = !!process.argv[1] && (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

const KEY = process.env.VERIFY_API_KEY || process.env.AIHUBMIX_API_KEY;
if (isMain && !KEY) {
  console.error('✗ 需要环境变量 VERIFY_API_KEY（或 AIHUBMIX_API_KEY，真实打网关用）。');
  console.error('  例：VERIFY_API_KEY=sk-xxx node scripts/verify-codegen.mjs --model gpt-5.5');
  process.exit(2);
}

// --base：既是取 schema 的地址，也是**注入进 ctx.baseUrl 的地址**。
// 原先脚本是 `code.replaceAll('https://aihubmix.com', BASE_OVERRIDE)` 后处理换域，意味着
// 「被验证的字节 ≠ 用户拿到的字节」；baseUrl 变必填之后直接传进 ctx，验的就是真产物。
const BASE = argVal('--base') || 'https://aihubmix.com';

const PROMPT = 'Reply with exactly: ok';

/** 拉模型 schema，按 endpoints.kind 解析出该模型真支持的协议（与 UI 同源），
 *  并取各协议 schema 声明的参数键（paramKeys）——与 app 的 splitParamsBySchema 同源，
 *  buildBody / goChat 据此门控（如 gpt-5 系 go-openai 需 MaxCompletionTokens）。
 *  返回 { protos, paramKeysByProto }；解析失败退回全量协议 + 无门控。 */
async function resolveSchema(model, KIND2PROTO, ALL_PROTOS) {
  try {
    const res = await fetch(`${BASE}/api/v1/models/${encodeURIComponent(model)}/schema`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const doc = json.data ?? json;
    const paramKeysByProto = {};
    const paramPropsByProto = {};
    for (const e of doc.endpoints || []) {
      const proto = KIND2PROTO[e.kind];
      if (!proto) continue;
      const props = e.request?.schema?.properties || e.request?.properties;
      if (props) {
        paramKeysByProto[proto] = Object.keys(props);
        paramPropsByProto[proto] = props;
      }
    }
    const list = ALL_PROTOS.filter((p) => p in paramKeysByProto);
    return { protos: list.length ? list : ALL_PROTOS, paramKeysByProto, paramPropsByProto };
  } catch {
    return { protos: ALL_PROTOS, paramKeysByProto: {}, paramPropsByProto: {} }; // 解析失败退回全量、不门控
  }
}

// 数值字段常被 anyOf 包 nullable：取带约束(type/enum)的那一支（与后台/参数矩阵同口径）。
function constraintOf(fs) {
  if (!fs || typeof fs !== 'object') return {};
  if ((fs.type && fs.type !== 'null') || fs.enum || fs.const !== undefined) return fs;
  for (const b of ['anyOf', 'oneOf', 'allOf']) {
    for (const sub of fs[b] || []) {
      if (sub && typeof sub === 'object' && sub.type !== 'null' && (sub.type || sub.enum || sub.const !== undefined)) return sub;
    }
  }
  return fs;
}

// 参数值按模型 schema 取：const 钉死 > schema default > 通用值 clamp 进 [min,max]。
// 语义 = playground 参数面板的初始值——验证的不是「通用参数能不能过」,而是「这个模型
// 配置的参数取值跟着示例代码发出去能不能过」（收窄后通用值可能已出界）。
// aliases：同一语义参数在不同协议字段名不同（max_tokens/max_completion_tokens/max_output_tokens）。
function schemaParamValue(props, keys, generic) {
  for (const k of keys) {
    const c = constraintOf(props?.[k]);
    if (c.const !== undefined && c.const !== null) return c.const;
    if (c.default !== undefined && c.default !== null) return c.default;
    if (typeof c.maximum === 'number' || typeof c.minimum === 'number') {
      let v = generic;
      if (typeof c.maximum === 'number' && v > c.maximum) v = c.maximum;
      if (typeof c.minimum === 'number' && v < c.minimum) v = c.minimum;
      return v;
    }
  }
  return generic;
}

// ---- 1) 用 esbuild 把包入口打成可 import 的临时 mjs ----
// 打 src/index.ts（不是 dist）：验的是当前工作树的源码，免得忘了 build 而验到旧产物。
async function loadCodegen() {
  const out = join(await mkdtemp(join(tmpdir(), 'cg-')), 'codegen.mjs');
  await pexec('npx', [
    'esbuild', join(ROOT, 'src/index.ts'),
    '--bundle', '--format=esm', `--outfile=${out}`,
  ], { cwd: ROOT });
  return import(out);
}

// ---- 2) 确保 node 运行时有 openai / @anthropic-ai/sdk ----
async function ensureNodeRuntime(installCmd) {
  if (existsSync(join(RUNTIME, 'node_modules', 'openai'))) return true;
  console.log(`· 首次准备 node 运行时（${installCmd} → scripts/.verify-runtime）…`);
  await mkdir(RUNTIME, { recursive: true });
  await writeFile(join(RUNTIME, 'package.json'), JSON.stringify({ name: 'verify-runtime', private: true, type: 'module' }, null, 2));
  await writeFile(join(RUNTIME, '.gitignore'), 'node_modules/\n');
  try {
    await pexec('npm', ['install', '--silent', '--no-audit', '--no-fund', 'openai', '@anthropic-ai/sdk'], { cwd: RUNTIME, timeout: 180000 });
    return true;
  } catch (e) {
    console.warn('  ⚠ node SDK 安装失败，node 组合将跳过：', e.message?.slice(0, 120));
    return false;
  }
}

// ---- 2b) 其它语言运行时探测 / 准备（缺则该语言 skip）----
// 探测统一走 config/languages.ts 的 probe：真跑一次版本命令拿退出码。
// 不用 `command -v` —— macOS 自带的 java stub 能骗过它，探测通过但一编译就炸。
async function probeOk(def) {
  if (!def?.probe) return true; // 无 probe = 无需运行时
  try {
    await pexec(def.probe.cmd, def.probe.args, { timeout: 15000 });
    return true;
  } catch (e) {
    // java -version 走 stderr 但 exit 0；stub 则 exit≠0 → 落到 catch
    return e.code === 0;
  }
}

// go：建临时 module 并拉 go-openai（chat 用 SDK；messages/responses 用 stdlib）
async function ensureGoRuntime(def) {
  if (!(await probeOk(def))) return { ok: false, reason: 'go 未安装' };
  if (existsSync(join(RUNTIME_GO, 'go.sum'))) return { ok: true };
  console.log(`· 首次准备 go 运行时（go mod init + ${def.install} → scripts/.verify-runtime-go）…`);
  await mkdir(RUNTIME_GO, { recursive: true });
  await writeFile(join(RUNTIME_GO, '.gitignore'), '*\n');
  try {
    if (!existsSync(join(RUNTIME_GO, 'go.mod')))
      await pexec('go', ['mod', 'init', 'verifyruntime'], { cwd: RUNTIME_GO, timeout: 60000 });
    await pexec('go', ['get', 'github.com/sashabaranov/go-openai@latest'], { cwd: RUNTIME_GO, timeout: 180000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'go-openai 拉取失败：' + (e.message || '').slice(0, 80) };
  }
}

// ruby：装 ruby-openai gem 到本地 GEM_HOME（仅 chat/responses 需要；messages 用 net/http 零 gem）
async function ensureRubyRuntime(def) {
  if (!(await probeOk(def)))
    return { rubyOk: false, gemOk: false, reason: 'ruby 未安装', env: process.env };
  const env = { ...process.env, GEM_HOME: RUNTIME_RUBY, GEM_PATH: RUNTIME_RUBY };
  if (existsSync(join(RUNTIME_RUBY, 'gems'))) {
    // 已装过：确认 openai gem 在
    const gemOk = (await pexec('bash', ['-lc', `ls ${RUNTIME_RUBY}/gems | grep -i ruby-openai`]).then(() => true).catch(() => false));
    return { rubyOk: true, gemOk, env };
  }
  console.log(`· 首次准备 ruby 运行时（${def.install} → scripts/.verify-runtime-ruby）…`);
  await mkdir(RUNTIME_RUBY, { recursive: true });
  try {
    await pexec('gem', ['install', '--install-dir', RUNTIME_RUBY, '--no-document', 'ruby-openai'], { timeout: 180000, env });
    return { rubyOk: true, gemOk: true, env };
  } catch (e) {
    // 装不上（如系统 ruby 过旧）：chat/responses skip，messages 仍可跑
    return { rubyOk: true, gemOk: false, reason: 'ruby-openai 装不上：' + (e.message || '').slice(0, 80), env };
  }
}

// ---- 3) 构造 codegen ctx（非流式更易判定成功；--stream 可切流式）----
// baseUrl 必填且就是 --base：验的字节 == 用户拿到的字节（不再事后 replaceAll 换域）。
// paramKeys 来自 schema（与 app 同源）：buildBody 据此门控数值参数，goChat 据此选 MaxCompletionTokens。
// p 的取值也按 schema 来（schemaParamValue）——不是只换模型名，模型配置的参数值要一起带进示例。
function makeCtx(paramKeys, props) {
  return {
    baseUrl: BASE,
    model: { id: model },
    sys: '',
    user: PROMPT,
    p: {
      max_tokens: schemaParamValue(props, ['max_tokens', 'max_completion_tokens', 'max_output_tokens'], 1024),
      temperature: schemaParamValue(props, ['temperature'], 1),
      top_p: schemaParamValue(props, ['top_p'], 1),
      top_k: schemaParamValue(props, ['top_k'], 0),
      frequency_penalty: schemaParamValue(props, ['frequency_penalty'], 0),
      presence_penalty: schemaParamValue(props, ['presence_penalty'], 0),
      repetition_penalty: schemaParamValue(props, ['repetition_penalty'], 1),
    },
    stream,
    tools: null,
    think: false,
    thinkLevel: 'medium',
    structured: null,
    paramKeys,
  };
}

// dotnet：探测 SDK 主版本，TargetFramework 对齐已装运行时（只装了 SDK10 时 net8.0 会缺运行时跑不起来）。
async function detectDotnet() {
  try {
    const { stdout } = await pexec('dotnet', ['--version'], { timeout: 15000 });
    const major = (stdout.trim().match(/^(\d+)/) || [])[1];
    return { ok: !!major, tfm: major ? `net${major}.0` : 'net8.0' };
  } catch {
    return { ok: false, tfm: 'net8.0' };
  }
}

// ---- 4) 跑单个组合 ----
// 失败判定分两层(见 classify):
//   ① 结构化优先——能从输出解析出 API 响应信封时,只认顶层 error 字段。合法 200 的 usage token 数
//      (完/思考 token 恰好=429/503)、gemini thoughtSignature 的 base64、deepseek 思考正文里的英文词,
//      全在 body 内,一律不再拿黑名单扫,根治思考型模型随机假红(TASK-C3PSS8)。
//   ② 兜底黑名单——只对「解析不出 JSON 信封」的输出(SDK 崩溃 traceback / 纯文本报错 / 传输层错误)生效。
//      raw-HTTP 示例(curl/go/java/c#/ruby-net-http)4xx/5xx 也 exit 0,但其错误体是 JSON,已被 ① 覆盖。
// 裸数字 429/50x 只在带 http/status 语境时才当错误码,不再匹配孤立数值(usage token 计数常驻此区间→假红)。
const OK_FAIL_RE = /"error"\s*:\s*[{"]|invalid|unauthorized|forbidden|no key|not found|traceback|exception|cannot find|module not found|rate.?limit|too many requests|insufficient|quota|overloaded|no.?valid.?channel|余额不足|请求过于频繁|负载已饱和/i;

// HTTP 错误状态码——必须带 http/status/code 语境、JSON 状态键,或紧跟标准原因短语;
// 绝不匹配裸 429/503(那会撞 usage 的 completion_tokens/total_tokens 数)。
const HTTP_ERR_CODE = /\bHTTP\/?[\d.]*\s*(?:429|50[0234])\b|\bstatus(?:[ _-]?code)?\s*[:=]?\s*(?:429|50[0234])\b|"(?:status|code|status_code)"\s*:\s*"?(?:429|50[0234])\b|\b(?:429|50[0234])\s+(?:too many requests|internal server error|bad gateway|service unavailable|gateway timeout|server error)\b/i;

// 瞬时/可重试信号:传输层错误 + 上游过载/限流。命中则退避重试(区分"生成器坏"与"网络抖动",防假红)。
// JSON 错误码只认带 "code"/"status"/"status_code" 键名的 429/50x,不认裸 usage token 数(completion_tokens 等)。
const NET_RETRY_RE = /too many requests|rate.?limit|overloaded|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|temporarily|负载已饱和|请求过于频繁|"(?:status|code|status_code)"\s*:\s*"?(?:429|50[234])\b/i;

/** 该语言该协议的落盘文件名（config/languages.ts 的 fileName 优先，否则按 ext 起名）。 */
function srcName(def, proto) {
  return def.fileName || `run-${proto}${def.ext}`;
}

async function runCombo(gen, proto, lang, rt) {
  const def = gen.langDef(lang);
  const code = gen.generateCode(proto, lang, makeCtx(rt.paramKeysByProto[proto], rt.paramPropsByProto?.[proto]));
  const withKey = () => code.replace(/AIHUBMIX_API_KEY/g, KEY);
  const dir = await mkdtemp(join(tmpdir(), `vc-${proto}-${lang}-`));
  try {
    if (lang === 'curl') {
      const file = join(dir, srcName(def, proto));
      await writeFile(file, withKey());
      return classify(await capture('bash', [file], {}));
    }
    if (lang === 'python') {
      const file = join(dir, srcName(def, proto));
      await writeFile(file, withKey());
      return classify(await capture('python3', [file], {}));
    }
    if (lang === 'javascript') {
      if (!rt.nodeReady) return { ok: null, note: 'node SDK 未就绪，跳过' };
      // ESM import 不认 NODE_PATH —— 把脚本写进 RUNTIME 目录，node 沿目录上溯解析 RUNTIME/node_modules
      const file = join(RUNTIME, srcName(def, proto));
      await writeFile(file, code); // 代码用 process.env.AIHUBMIX_API_KEY，设 env 即可
      try {
        return classify(await capture('node', [file], { env: { ...process.env, AIHUBMIX_API_KEY: KEY } }));
      } finally {
        await rm(file, { force: true }).catch(() => {});
      }
    }
    if (lang === 'go') {
      if (!rt.go.ok) return { ok: null, note: rt.go.reason || 'go 未就绪，跳过' };
      // 写进 module 目录、按 proto 唯一命名（go run <file> 只编译指定文件，并发安全）
      const file = join(RUNTIME_GO, srcName(def, proto));
      await writeFile(file, withKey());
      try {
        return classify(await capture('go', ['run', file], { cwd: RUNTIME_GO, timeout: 120000 }));
      } finally {
        await rm(file, { force: true }).catch(() => {});
      }
    }
    if (lang === 'java') {
      if (!rt.javaOk) return { ok: null, note: 'JDK 未安装，跳过' };
      // 单文件源码模式：java Main.java（JDK 11+，零依赖）——文件名必须与 public class 同名
      const file = join(dir, srcName(def, proto));
      await writeFile(file, withKey());
      return classify(await capture('java', [file], { timeout: 120000 }));
    }
    if (lang === 'csharp') {
      if (!rt.dotnet.ok) return { ok: null, note: 'dotnet SDK 未安装，跳过' };
      await writeFile(join(dir, srcName(def, proto)), withKey());
      await writeFile(join(dir, 'app.csproj'),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>` +
        `<TargetFramework>${rt.dotnet.tfm}</TargetFramework><ImplicitUsings>enable</ImplicitUsings>` +
        `<Nullable>disable</Nullable></PropertyGroup></Project>`);
      // 抑制 .NET 首次运行欢迎横幅/遥测，否则 banner 会混入输出导致误判。
      const dotnetEnv = {
        ...process.env,
        DOTNET_NOLOGO: '1',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
      };
      return classify(await capture('dotnet', ['run', '--project', dir], { cwd: dir, timeout: 180000, env: dotnetEnv }));
    }
    if (lang === 'ruby') {
      if (!rt.ruby.rubyOk) return { ok: null, note: 'ruby 未安装，跳过' };
      // messages 用原生 net/http（无需 gem）；chat/responses 用 ruby-openai gem
      if (proto !== 'messages' && !rt.ruby.gemOk)
        return { ok: null, note: rt.ruby.reason || 'ruby-openai 未就绪，跳过' };
      const file = join(dir, srcName(def, proto));
      await writeFile(file, withKey());
      return classify(await capture('ruby', [file], { env: rt.ruby.env }));
    }
    // config/languages.ts 加了语言但这里没加执行分支 —— 显式标出，不静默当 skip 放行。
    return { ok: false, note: `harness 未实现该语言的执行方式：${lang}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function capture(cmd, argv, opts) {
  // 默认超时 120s(推理/流式模型非流式响应常 >60s,60s 会误 kill→假红);单次执行 + 瞬时错误退避重试。
  // 重试无论退出码:curl 等 raw-HTTP 对 429/5xx 也 exit 0,只能从输出识别瞬时信号。
  const attempts = 3;
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout, stderr } = await pexec(cmd, argv, { timeout: 120000, maxBuffer: 8 << 20, ...opts });
      last = { code: 0, out: (stdout || '') + (stderr || '') };
    } catch (e) {
      last = { code: e.code ?? 1, out: ((e.stdout || '') + (e.stderr || '')) || e.message || '' };
    }
    if (i < attempts - 1 && (NET_RETRY_RE.test(last.out) || HTTP_ERR_CODE.test(last.out))) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1))); // 线性退避 0.8s/1.6s
      continue;
    }
    return last;
  }
  return last;
}

// 从混合输出里扫出所有能解析的 JSON 对象:字符串感知的花括号配平(不被 body 内的 "}" 骗到),
// SSE 多块(data: {...})、前后夹日志都能命中。输出体量小(单条响应),O(n²) 最坏可接受。
function extractJsonObjects(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { end = j; break; }
    }
    if (end === -1) break; // 未闭合:后面不会再有完整对象
    try { out.push(JSON.parse(text.slice(i, end + 1))); } catch { /* 非 JSON 片段,跳过 */ }
    i = end; // 跳过已消费段,避免嵌套对象被重复扫
  }
  return out;
}

// 是否像一个 API 响应信封(据此决定走「结构化优先」还是「兜底黑名单」)。
// 注意:不含 'message' —— 顶层 {"message":"...错误..."} 若无 error 键会被误当成功信封而假绿;
// chat/messages/responses 成功一律带 id/usage/content/choices 之一,无需靠 message 识别。
const ENVELOPE_KEYS = ['choices', 'candidates', 'content', 'output', 'output_text', 'id', 'usage', 'model', 'object', 'delta'];
function looksLikeEnvelope(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if ('error' in o) return true;
  return ENVELOPE_KEYS.some((k) => k in o);
}

// error 字段是否为「真错」:非空对象 / 非空字符串 / 真值标量算错;null/缺失/空串/空对象不算(responses 成功含 error:null)。
function isRealError(err) {
  if (err == null) return false;
  if (typeof err === 'string') return err.trim().length > 0;
  if (typeof err === 'object') return Object.keys(err).length > 0;
  return Boolean(err);
}

const FAIL_SLICE = 600; // 放宽失败截断(原 160 常把 finish_reason/错误详情切没,运营甄别困难)。
function briefFail(text, err) {
  let s = err !== undefined ? 'error=' + (typeof err === 'string' ? err : JSON.stringify(err)) : text;
  s = s.slice(0, FAIL_SLICE).replace(/\s+/g, ' ').trim();
  return s;
}

function classify({ code, out }) {
  const text = (out || '').trim();
  // ① 结构化优先:能解析出响应信封,就只认顶层 error 字段——body 内的 token 数/base64/思考正文一律不扫。
  const envelopes = extractJsonObjects(text).filter(looksLikeEnvelope);
  if (envelopes.length > 0) {
    const bad = envelopes.find((e) => isRealError(e.error));
    if (bad) return { ok: false, note: briefFail(text, bad.error) || `exit ${code}` };
    // 成功信封 + 干净退出 → 通过。退出码非 0(打印响应后又崩溃)不轻信,落到 ② 兜底。
    if (code === 0) return { ok: true, note: text.slice(0, 80).replace(/\s+/g, ' ') };
  }
  // ② 兜底:解析不出信封(SDK 崩溃 traceback / 纯文本报错 / 传输层错误)才用黑名单 + 状态码锚。
  const ok = code === 0 && text.length > 0 && !OK_FAIL_RE.test(text) && !HTTP_ERR_CODE.test(text);
  return { ok, note: ok ? text.slice(0, 80).replace(/\s+/g, ' ') : (briefFail(text) || `exit ${code}`) };
}

// 有界并发 map:同时最多 limit 个 fn 在跑,避免 Promise.all 一次性拉满。
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// 单测入口:仅导出纯判定函数,不触发主流程(被 import 时 isMain=false)。
export { classify, extractJsonObjects, looksLikeEnvelope, isRealError, OK_FAIL_RE, HTTP_ERR_CODE, NET_RETRY_RE };

// ---- 5) 主流程 ----
if (isMain) (async () => {
  const gen = await loadCodegen();
  // 语言与协议清单一律取自包的 config 层：加语言/加协议自动进验证矩阵，不会「加了却没被真跑」。
  const LANGS = gen.LANGS.map((l) => l.id);
  const ALL_PROTOS = gen.PROTOCOLS.map((p) => p.id);
  const { protos: PROTOS, paramKeysByProto, paramPropsByProto } =
    await resolveSchema(model, gen.KIND_TO_PROTO, ALL_PROTOS); // 协议 + 各协议 paramKeys
  console.log(`\naihubmix codegen 验证 — model=${model}  base=${BASE}  stream=${stream}`);
  console.log(`langs=[${LANGS}]  protos=[${PROTOS}]（按 schema 解析）\n`);
  // 各语言运行时按需准备（缺则对应组合 skip，不阻塞）
  const [nodeReady, goRt, rubyRt, javaOk, dotnet] = await Promise.all([
    ensureNodeRuntime(gen.langDef('javascript').install),
    ensureGoRuntime(gen.langDef('go')),
    ensureRubyRuntime(gen.langDef('ruby')),
    probeOk(gen.langDef('java')),
    detectDotnet(),
  ]);
  const rt = { nodeReady, go: goRt, ruby: rubyRt, javaOk, dotnet, paramKeysByProto, paramPropsByProto };
  for (const m of [goRt.reason, rubyRt.reason].filter(Boolean)) console.log(`  ⚠ ${m}`);
  if (!javaOk) console.log('  ⚠ JDK 未安装：java 组合将 skip');
  if (!dotnet.ok) console.log('  ⚠ dotnet SDK 未安装：csharp 组合将 skip');

  const jobs = [];
  for (const proto of PROTOS) for (const lang of LANGS) jobs.push({ proto, lang });
  // 并发上限:21 组合(协议×语言)全并发在 2 核 runner 上真实编译+调用会互相拖慢→逼近超时→成片假红。
  // 限 4 并发,失败/异常隔离到单组合(runCombo 内已 try/catch,这里再兜 writeFile/mkdtemp 冒泡)。
  const results = await mapPool(jobs, 4, (j) =>
    runCombo(gen, j.proto, j.lang, rt)
      .then((r) => ({ ...j, ...r }))
      .catch((e) => ({ ...j, ok: false, note: `harness err: ${(e.message || e).toString().slice(0, 100)}` })));

  // 矩阵
  const cell = (r) => (!r || r.ok === null ? 'skip' : r.ok ? '✓' : '✗');
  const pad = (s, n) => s.padEnd(n);
  const W = 12;
  console.log(pad('protocol', 12) + LANGS.map((l) => pad(l, W)).join(''));
  for (const proto of PROTOS) {
    const row = results.filter((r) => r.proto === proto);
    console.log(pad(proto, 12) + LANGS.map((l) => pad(cell(row.find((r) => r.lang === l)), W)).join(''));
  }
  // 失败详情
  const bad = results.filter((r) => r.ok === false);
  if (bad.length) {
    console.log('\n失败详情：');
    for (const r of bad) console.log(`  ✗ ${r.proto}/${r.lang}: ${r.note}`);
  }
  const total = results.length;
  const passed = results.filter((r) => r.ok === true).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n结果：${passed}/${total - skipped} 通过${skipped ? `，${skipped} 跳过` : ''}。`);

  // 防假绿:skip 在门禁层不能等同 pass。runtime 集体缺失/装失败会让大量组合 skip,
  // 若不设底,极端下"0/0 通过 21 跳过"仍 exit 0 → 网关收到"成功"却零验证放行。
  // 底线:核心语言(curl 恒可用 + python)必须至少各真跑过一次,且总通过数>0。
  const CORE = ['curl', 'python'];
  const coreRan = CORE.every((l) => results.some((r) => r.lang === l && r.ok !== null));
  if (passed === 0) {
    console.error('\n✗ 零组合真实通过(全 skip 或全失败)——不作为成功结论,exit 2。');
    process.exit(2);
  }
  if (!coreRan) {
    console.error(`\n✗ 核心语言(${CORE.join('/')})未真实运行(运行时缺失?)——覆盖塌方,不放行,exit 2。`);
    process.exit(2);
  }
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.error('harness 异常：', e);
  process.exit(2);
});
