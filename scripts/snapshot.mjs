/**
 * snapshot.mjs —— codegen 输出基线快照。
 *
 * 用途：抽包重构（搬文件 / 抽 config / 换查表 / 收拢能力门控）每一步都声称「零字节差异」。
 * 这个脚本把 generateCode + generateMediaCode 在一组固定 ctx 上的全部产物落盘，
 * 重构前后各跑一次、diff 目录即可判定回归 —— 不依赖网络、不依赖 key、完全确定性。
 *
 * 用法：
 *   node scripts/snapshot.mjs --src <codegen 入口.ts> --alias <@ 指向的根目录> --out <目录>
 *
 * 旧源（playground）：
 *   node scripts/snapshot.mjs --src ~/code/playground/src/lib/codegen.ts \
 *     --alias ~/code/playground/src --out .snapshots/before
 * 新源（本包）：
 *   node scripts/snapshot.mjs --src src/index.ts --out .snapshots/after
 *
 * 比对：diff -r .snapshots/before .snapshots/after
 */
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const args = process.argv.slice(2);
const argVal = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const expand = (p) => (p.startsWith('~') ? join(process.env.HOME, p.slice(1)) : p);

const SRC = resolve(expand(argVal('--src', 'src/index.ts')));
const ALIAS = argVal('--alias') ? resolve(expand(argVal('--alias'))) : null;
const OUT = resolve(expand(argVal('--out', '.snapshots/out')));

// base 归一化：早期 codegen 内部写死 https://aihubmix.com,现在由 ctx.baseUrl 注入。
// 快照统一归一成占位,好让基线（搬家前）与现在可比 —— diff 只反映真实结构变化,不是域名换了。
const BASE_TOKEN = '__BASE__';
const KNOWN_BASES = ['https://aihubmix.com'];

// ---- 固定输入:全部字面量,无随机、无时间、无网络 ----
const MODEL = 'claude-opus-5';
const PROMPT = 'Summarize the differences between the four protocols.';
// 转义面:引号/反斜杠/反引号/ruby 插值/shell 命令替换/换行,一次打满。
const NASTY = 'He said "hi" \\ back`tick` #{rb} $(whoami) \'single\'\nsecond line';

const TOOLS = [
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: JSON.stringify({
      type: 'object',
      properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
      required: ['city'],
    }),
  },
];
const STRUCTURED = {
  format: 'json_schema',
  name: 'answer',
  schema: JSON.stringify({
    type: 'object',
    properties: { answer: { type: 'string' }, score: { type: 'number' } },
    required: ['answer'],
    additionalProperties: false,
  }),
};
const IMAGES = [
  { id: 'i1', kind: 'url', src: 'https://example.com/photo.jpg', mime: 'image/jpeg', modality: 'image' },
];
const HISTORY = [
  { role: 'user', content: 'What is the weather in Paris?' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }],
  },
  { role: 'tool', content: '{"temp_c":21}', toolCallId: 'call_1' },
  { role: 'user', content: PROMPT },
];

// 全量 paramKeys:让 schema 门控放行所有参数,最大化 buildBody 的分支覆盖。
const PARAM_KEYS = [
  'max_tokens', 'max_completion_tokens', 'max_output_tokens',
  'temperature', 'top_p', 'top_k',
  'frequency_penalty', 'presence_penalty', 'repetition_penalty',
  'seed', 'n', 'top_logprobs', 'logprobs',
  'verbosity', 'service_tier', 'reasoning_effort',
  'logit_bias', 'stop', 'metadata', 'parallel_tool_calls',
  'text', 'reasoning', 'thinking',
];

const baseP = {
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  frequency_penalty: 0.1,
  presence_penalty: 0.2,
  repetition_penalty: 1.05,
};

const ctxBase = {
  baseUrl: KNOWN_BASES[0],
  model: { id: MODEL },
  sys: 'You are a concise assistant.',
  user: PROMPT,
  p: baseP,
  stream: false,
  paramKeys: PARAM_KEYS,
};

/** ctx 变体:每个变体只拨动一组开关,覆盖 buildBody 的一条分支。 */
const VARIANTS = {
  base: {},
  stream: { stream: true },
  'no-sys': { sys: '' },
  escaping: { user: NASTY, sys: NASTY },
  tools: { tools: TOOLS, toolChoice: { mode: 'required' } },
  'tools-named': { tools: TOOLS, toolChoice: { mode: 'tool', name: 'get_weather' } },
  structured: { structured: STRUCTURED },
  think: { think: true, thinkLevel: 'high' },
  'think-adaptive': { think: true, thinkLevel: 'xhigh', thinkAdaptive: true },
  images: { images: IMAGES },
  cache: { cache: true },
  history: { messages: HISTORY },
  'web-search': { webSearch: true },
  'image-out': { imageOut: true },
  params: {
    enums: { verbosity: 'low', service_tier: 'auto', reasoning_effort: 'medium' },
    enumDefaults: { service_tier: 'auto' },
    objects: {
      logit_bias: { 1234: -100 },
      stop: ['\n\n', 'END'],
      metadata: { thread: 'abc-42' },
      parallel_tool_calls: false,
    },
    p: { ...baseP, seed: 7, n: 1, top_logprobs: 3 },
  },
  everything: {
    stream: true,
    messages: HISTORY,
    images: IMAGES,
    tools: TOOLS,
    toolChoice: { mode: 'auto' },
    structured: STRUCTURED,
    think: true,
    thinkLevel: 'high',
    cache: true,
    webSearch: true,
    enums: { verbosity: 'high' },
    objects: { stop: ['END'] },
    p: { ...baseP, seed: 7 },
  },
};

/** 媒体侧变体。endpoint 缺省 → 走 config 兜底路由;显式 endpoint → 走 schema 路由。 */
const MEDIA_VARIANTS = {
  'image-default': {
    modality: 'image',
    modelId: 'gpt-image-2',
    prompt: PROMPT,
    params: { size: '1024x1024', n: 1, quality: 'high' },
  },
  'image-escaping': {
    modality: 'image',
    modelId: 'gpt-image-2',
    prompt: NASTY,
    params: { size: '1024x1024' },
  },
  'image-endpoint': {
    modality: 'image',
    modelId: 'gpt-image-2',
    prompt: PROMPT,
    params: { size: '1024x1024' },
    endpoint: { path: '/ai/v1/images/edits', envelope: 'none', encoding: 'multipart' },
    refImages: { image: IMAGES },
  },
  'video-default': {
    modality: 'video',
    modelId: 'veo-3.5',
    prompt: PROMPT,
    params: { seconds: 8, size: '1280x720' },
  },
  'video-ref': {
    modality: 'video',
    modelId: 'seedance-2',
    prompt: PROMPT,
    params: { duration: 5, resolution: '1080p' },
    refImages: { first_frame_image: IMAGES },
  },
};

async function loadCodegen() {
  const dir = await mkdtemp(join(tmpdir(), 'cg-snap-'));
  const out = join(dir, 'codegen.mjs');
  const esbuildArgs = [SRC, '--bundle', '--format=esm', `--outfile=${out}`];
  if (ALIAS) esbuildArgs.push(`--alias:@=${ALIAS}`);
  await pexec('npx', ['esbuild', ...esbuildArgs], { cwd: process.cwd() });
  return { mod: await import(out), dir };
}

/** 把已知 base 归一化成占位符,使 BASE 重构前后的 diff 只反映结构变化。 */
function normalize(code) {
  let s = String(code);
  for (const b of KNOWN_BASES) s = s.split(b).join(BASE_TOKEN);
  return s;
}

async function main() {
  const { mod, dir } = await loadCodegen();
  const { generateCode, generateMediaCode, LANGS, PROTOCOLS } = mod;
  if (typeof generateCode !== 'function') throw new Error('入口未导出 generateCode');

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let n = 0;
  const index = [];
  for (const [vname, patch] of Object.entries(VARIANTS)) {
    const ctx = { ...ctxBase, ...patch };
    for (const proto of PROTOCOLS.map((x) => x.id)) {
      for (const lang of LANGS.map((x) => x.id)) {
        let body;
        try {
          body = normalize(generateCode(proto, lang, ctx));
        } catch (e) {
          body = `__THREW__ ${e && e.message}`;
        }
        const f = `api/${vname}/${proto}.${lang}.txt`;
        await mkdir(join(OUT, `api/${vname}`), { recursive: true });
        await writeFile(join(OUT, f), body);
        index.push(f);
        n++;
      }
    }
  }

  if (typeof generateMediaCode === 'function') {
    for (const [vname, opts] of Object.entries(MEDIA_VARIANTS)) {
      for (const lang of LANGS.map((x) => x.id)) {
        let body;
        try {
          body = normalize(generateMediaCode({ baseUrl: KNOWN_BASES[0], ...opts, lang }));
        } catch (e) {
          body = `__THREW__ ${e && e.message}`;
        }
        const f = `media/${vname}/${lang}.txt`;
        await mkdir(join(OUT, `media/${vname}`), { recursive: true });
        await writeFile(join(OUT, f), body);
        index.push(f);
        n++;
      }
    }
  }

  await writeFile(join(OUT, 'INDEX.txt'), index.sort().join('\n') + '\n');
  await rm(dir, { recursive: true, force: true });
  console.log(`快照 ${n} 份 → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
