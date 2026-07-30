/**
 * buildBody —— 唯一 wire body 真源。
 *
 * 28 个代码单元格与消费端的真实请求都必须经这里，不允许旁路拼 body（包不变量）。
 * 数值参数按 paramKeys（该协议 schema 声明集）门控，enum 参数来自 ctx.enums —— 一律以 schema 为准，
 * 做到「面板显示什么 == 请求发什么 == 代码示例出什么」。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { SPECIAL_NUM_KEYS } from '../config/wire-policy.js';
import { CAP_GATED_WIRE_KEYS, emitCapabilities } from './capabilities.js';
import { inSchema, isEmptyContainer } from './gate.js';
import { buildMediaContent } from './multimodal.js';
import { buildMessages } from './messages.js';

// 门控小工具住 gate.ts（body 与 capabilities 都要用，分文件避免成环），这里转出保持既有 import 路径。
export { inSchema, isEmptyContainer };

/** 把配置的 enum/字符串参数写进 body（schema 声明、取值非空且 ≠ schema 默认才发）。 */
function emitEnums(b: Record<string, unknown>, ctx: CodeGenCtx): void {
  const { enums, enumDefaults } = ctx;
  if (!enums) return;
  for (const [k, v] of Object.entries(enums)) {
    if (CAP_GATED_WIRE_KEYS.has(k)) continue; // 能力接管的字段，由对应能力门控块下发
    if (v === undefined || v === null || v === '') continue;
    if (!inSchema(ctx, k)) continue; // 当前协议 schema 未声明的键不发（与 emitObjects/emitExtraNumbers 一致）
    if (enumDefaults && enumDefaults[k] === v) continue; // 等于默认不发
    b[k] = v;
  }
}

/** 把配置的结构化参数（object/array/map）写进 body：非空、schema 声明、且非空容器才发。 */
function emitObjects(b: Record<string, unknown>, ctx: CodeGenCtx): void {
  const { objects } = ctx;
  if (!objects) return;
  for (const [k, v] of Object.entries(objects)) {
    if (CAP_GATED_WIRE_KEYS.has(k)) continue; // 能力接管的字段，由对应能力门控块下发
    if (v === undefined || v === null) continue;
    if (!inSchema(ctx, k)) continue; // 当前协议 schema 未声明的键不发
    if (isEmptyContainer(v)) continue; // 空 {} / [] 视为未设置
    b[k] = v;
  }
}

/**
 * 通用数值参数兜底：把 schema 声明、面板已展示的其余数值参数（seed / top_logprobs / n ...）写进 body。
 * 让「面板显示什么」==「请求发什么」——真·schema 驱动。特殊键已单独处理，这里跳过。
 */
function emitExtraNumbers(b: Record<string, unknown>, ctx: CodeGenCtx, proto: CodeProto): void {
  for (const [k, v] of Object.entries(ctx.p)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (SPECIAL_NUM_KEYS.has(k) || k in b) continue;
    if (!inSchema(ctx, k)) continue;
    b[k] = v;
    // OpenAI chat：用 top_logprobs 必须同时 logprobs:true。仅 chat 协议加——responses 用 include、messages 无此参数。
    if (k === 'top_logprobs' && proto === 'chat') b.logprobs = true;
  }
}

export function buildBody(proto: CodeProto, ctx: CodeGenCtx): Record<string, unknown> {
  const { model, sys, user, p, stream } = ctx;
  const imgs = ctx.images && ctx.images.length ? ctx.images : null;
  // 有完整会话历史 → 用 buildMessages 拼多轮（与真实请求同源）；否则退回 sys+user 单条兜底。
  const hist = ctx.messages && ctx.messages.length ? ctx.messages : null;
  if (proto === 'messages') {
    const b: Record<string, unknown> = {
      model: model.id,
      max_tokens: p.max_tokens,
    };
    // 显式缓存断点：有 system 则打在 system 文本块；否则打在 user 内容块（Anthropic cache_control）。
    const cc = { type: 'ephemeral' };
    if (sys) {
      b.system = ctx.cache ? [{ type: 'text', text: sys, cache_control: cc }] : sys;
    }
    // user 内容：有图片→截断占位符 content 数组；否则保持原字符串/缓存块逻辑
    let userContent: unknown;
    if (imgs) {
      const blocks = buildMediaContent('messages', user, imgs, { truncate: true });
      if (ctx.cache && !sys && blocks.length) {
        const tail = blocks[blocks.length - 1] as Record<string, unknown>;
        blocks[blocks.length - 1] = { ...tail, cache_control: cc };
      }
      userContent = blocks;
    } else {
      userContent = ctx.cache && !sys ? [{ type: 'text', text: user, cache_control: cc }] : user;
    }
    b.messages = hist
      ? buildMessages('messages', hist, sys, { cache: ctx.cache, truncate: true })
      : [{ role: 'user', content: userContent }];
    // 仅在非默认(1)时发 —— temperature/top_p 多数模型互斥，都按默认 1 发会被网关拒
    if (inSchema(ctx, 'temperature') && +(p.temperature ?? 1) !== 1) b.temperature = +(p.temperature ?? 1);
    if (inSchema(ctx, 'top_p') && +(p.top_p ?? 1) !== 1) b.top_p = +(p.top_p ?? 1);
    if (inSchema(ctx, 'top_k') && (p.top_k ?? 0) > 0) b.top_k = p.top_k;
    emitEnums(b, ctx);
    emitObjects(b, ctx);
    emitExtraNumbers(b, ctx, proto);
    emitCapabilities(b, ctx, proto);
    b.stream = stream;
    return b;
  }
  if (proto === 'responses') {
    const b: Record<string, unknown> = { model: model.id };
    if (sys) b.instructions = sys;
    // 有历史→完整 input 数组；否则单条（有图占位 / 纯文本）
    b.input = hist
      ? buildMessages('responses', hist, sys, { truncate: true })
      : imgs
        ? [{ role: 'user', content: buildMediaContent('responses', user, imgs, { truncate: true }) }]
        : user;
    b.max_output_tokens = p.max_tokens;
    if (inSchema(ctx, 'temperature') && +(p.temperature ?? 1) !== 1) b.temperature = +(p.temperature ?? 1);
    if (inSchema(ctx, 'top_p') && +(p.top_p ?? 1) !== 1) b.top_p = +(p.top_p ?? 1);
    emitEnums(b, ctx);
    emitObjects(b, ctx);
    emitExtraNumbers(b, ctx, proto);
    // text / reasoning 对象由能力门控下发：开启能力才发，且带上组内子字段（verbosity / mode/summary/…，
    // 值来自 structParams，开启时已预填有默认的子字段）+ 归能力的子键（format / effort）。关掉能力则整个不发。
    emitCapabilities(b, ctx, proto);
    b.stream = stream;
    return b;
  }
  if (proto === 'gemini') {
    // Gemini 原生 generateContent。采样参数已在参数面板扁平化为 gemini 原生名（temperature/topP/topK/
    // maxOutputTokens/stopSequences…），这里重新嵌回 generationConfig。stream 不进 body（走独立端点）。
    const b: Record<string, unknown> = {};
    const parts = imgs
      ? buildMediaContent('gemini', user, imgs, { truncate: true })
      : [{ text: user }];
    b.contents = hist
      ? buildMessages('gemini', hist, sys, { truncate: true })
      : [{ role: 'user', parts }];
    if (sys) b.systemInstruction = { parts: [{ text: sys }] };
    const gc: Record<string, unknown> = {};
    // temperature 在 SPECIAL_NUM_KEYS 里、emitExtraNumbers 会跳过，需显式发（gemini 无「默认1互斥」约束）。
    if (inSchema(ctx, 'temperature') && typeof p.temperature === 'number' && Number.isFinite(p.temperature))
      gc.temperature = p.temperature;
    emitEnums(gc, ctx); // responseMimeType 等
    emitObjects(gc, ctx); // stopSequences 等
    emitExtraNumbers(gc, ctx, proto); // topP/topK/maxOutputTokens/candidateCount/frequencyPenalty/...
    if (Object.keys(gc).length) b.generationConfig = gc;
    emitCapabilities(b, ctx, proto);
    return b;
  }
  // chat completions
  const msgs: unknown[] = [];
  if (sys) msgs.push({ role: 'system', content: sys });
  msgs.push({
    role: 'user',
    content: imgs ? buildMediaContent('chat', user, imgs, { truncate: true }) : user,
  });
  const b: Record<string, unknown> = {
    model: model.id,
    messages: hist ? buildMessages('chat', hist, sys, { truncate: true }) : msgs,
  };
  // 出图模型（如 Gemini 图像）走 chat 时必须声明输出模态，否则网关 400 / 不返回图片。
  if (ctx.imageOut) b.modalities = ['text', 'image'];
  // 最大输出：OpenAI 已软弃用 max_tokens → schema 声明 max_completion_tokens 时改用它（以 schema 为准）。
  if (ctx.paramKeys?.includes('max_completion_tokens') && !ctx.paramKeys.includes('max_tokens')) {
    b.max_completion_tokens = p.max_completion_tokens ?? p.max_tokens;
  } else {
    b.max_tokens = p.max_tokens;
  }
  if (inSchema(ctx, 'temperature') && +(p.temperature ?? 1) !== 1) b.temperature = +(p.temperature ?? 1);
  if (inSchema(ctx, 'top_p') && +(p.top_p ?? 1) !== 1) b.top_p = +(p.top_p ?? 1);
  if (inSchema(ctx, 'frequency_penalty') && +(p.frequency_penalty ?? 0) !== 0)
    b.frequency_penalty = +(p.frequency_penalty ?? 0);
  if (inSchema(ctx, 'presence_penalty') && +(p.presence_penalty ?? 0) !== 0)
    b.presence_penalty = +(p.presence_penalty ?? 0);
  if (inSchema(ctx, 'top_k') && (p.top_k ?? 0) > 0) b.top_k = p.top_k;
  if (inSchema(ctx, 'repetition_penalty') && +(p.repetition_penalty ?? 1) !== 1)
    b.repetition_penalty = +(p.repetition_penalty ?? 1);
  emitEnums(b, ctx);
  emitObjects(b, ctx);
  emitExtraNumbers(b, ctx, proto);
  emitCapabilities(b, ctx, proto);
  b.stream = stream;
  return b;
}
