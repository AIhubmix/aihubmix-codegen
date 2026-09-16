/**
 * 渲染器查表 —— 替代原来 4 协议 × 7 语言的 if 链。
 *
 * 实现本来就是**分层**的，表只是把这个事实写明白：
 * - SDK 语言（python / javascript / ruby）每个协议单独实现，go 仅 chat 特殊化；
 * - 其余落 `default`，即通用原生 REST 实现（`goRaw` / `javaRaw` / `csRaw` / `curl`
 *   各自一个函数吃 4 协议）。加语言 = 加一条记录 + 一个 `xxRaw`，自动覆盖 4 协议。
 *
 * **不导出 registerLanguage() 这类外部注册 API**：没有第二个注册方，且外部注册的语言
 * 绕过 scripts/verify-codegen.mjs 的真跑验证 —— 那会产出「没被验证过的示例」。
 */
import type { CodeGenCtx, CodeLang, CodeProto, MediaCodeGenOpts } from '../types.js';
import type { MediaCtx } from '../wire/media.js';
import { csRaw } from './csharp.js';
import { curl } from './curl.js';
import { goChat, goRaw } from './go.js';
import { javaRaw } from './java.js';
import { pyChat, pyGemini, pyMessages, pyResponses } from './python.js';
import { rubyChat, rubyGemini, rubyMessages, rubyResponses } from './ruby.js';
import { tsChat, tsGemini, tsMessages, tsResponses } from './typescript.js';
import { mediaImageCs, mediaVideoCs } from './media/csharp.js';
import { mediaImageCurl, mediaVideoCurl } from './media/curl.js';
import { mediaImageGo, mediaVideoGo } from './media/go.js';
import { mediaImageJava, mediaVideoJava } from './media/java.js';
import { mediaImagePy, mediaVideoPy } from './media/python.js';
import { mediaImageRuby, mediaVideoRuby } from './media/ruby.js';
import { mediaImageTs, mediaVideoTs } from './media/typescript.js';
import { realtimeCurl } from './realtime/curl.js';
import { realtimeFallback } from './realtime/fallback.js';
import { realtimePy } from './realtime/python.js';
import { realtimeTs } from './realtime/typescript.js';
import type { RealtimeCtx } from '../wire/realtime.js';

export type Renderer = (proto: CodeProto, ctx: CodeGenCtx) => string;

/** 协议无关的 SDK 渲染器（只吃 ctx）包成统一签名。 */
const only = (fn: (ctx: CodeGenCtx) => string): Renderer => (_proto, ctx) => fn(ctx);

export const RENDERERS: Record<CodeLang, Partial<Record<CodeProto, Renderer>> & { default: Renderer }> = {
  python: {
    chat: only(pyChat),
    messages: only(pyMessages),
    responses: only(pyResponses),
    gemini: only(pyGemini),
    default: only(pyResponses),
  },
  javascript: {
    chat: only(tsChat),
    messages: only(tsMessages),
    responses: only(tsResponses),
    gemini: only(tsGemini),
    default: only(tsResponses),
  },
  ruby: {
    chat: only(rubyChat),
    messages: only(rubyMessages),
    responses: only(rubyResponses),
    gemini: only(rubyGemini),
    default: only(rubyResponses),
  },
  // go-openai 只覆盖 chat；其余协议走 net/http 原生 REST。
  go: { chat: only(goChat), default: goRaw },
  java: { default: javaRaw },
  csharp: { default: csRaw },
  curl: { default: curl },
};

export type MediaRenderer = (ctx: MediaCtx) => string;

export type RealtimeRenderer = (ctx: RealtimeCtx) => string;

/**
 * Realtime 渲染器：语言 → 渲染函数（WS 传输形态，独立于 CodeProto 表）。
 * a-lite 决策：python/typescript 精品 + curl 出 wscat 说明；go/java/csharp/ruby
 * 先给可行动的降级注释块（不空、不冒充 HTTP），完整模板后补。
 */
export const REALTIME_RENDERERS: Record<CodeLang, RealtimeRenderer> = {
  python: realtimePy,
  javascript: realtimeTs,
  curl: realtimeCurl,
  go: realtimeFallback('go'),
  java: realtimeFallback('java'),
  csharp: realtimeFallback('csharp'),
  ruby: realtimeFallback('ruby'),
};

/** 媒体渲染器：模态 × 语言。图是单段同步 POST，视频是提交 + 轮询 + 下载三段。 */
export const MEDIA_RENDERERS: Record<MediaCodeGenOpts['modality'], Record<CodeLang, MediaRenderer>> = {
  image: {
    python: mediaImagePy,
    javascript: mediaImageTs,
    go: mediaImageGo,
    java: mediaImageJava,
    csharp: mediaImageCs,
    ruby: mediaImageRuby,
    curl: mediaImageCurl,
  },
  video: {
    python: mediaVideoPy,
    javascript: mediaVideoTs,
    go: mediaVideoGo,
    java: mediaVideoJava,
    csharp: mediaVideoCs,
    ruby: mediaVideoRuby,
    curl: mediaVideoCurl,
  },
};
