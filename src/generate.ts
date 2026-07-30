/**
 * 分发层：generateCode（4 协议 × 7 语言）/ generateMediaCode（图/视频 × 7 语言）。
 *
 * if 链此处按原样保留（换 RENDERERS 查表是下一步，需单独对基线快照验零字节差异）。
 */
import type { CodeGenCtx, CodeLang, CodeProto, MediaCodeGenOpts } from './types.js';
import { MEDIA_PLACEHOLDER } from './config/placeholders.js';
import { buildMediaCtx, filterParams } from './wire/media.js';
import { csRaw } from './renderers/csharp.js';
import { curl } from './renderers/curl.js';
import { goChat, goRaw } from './renderers/go.js';
import { javaRaw } from './renderers/java.js';
import { pyChat, pyGemini, pyMessages, pyResponses } from './renderers/python.js';
import { rubyChat, rubyGemini, rubyMessages, rubyResponses } from './renderers/ruby.js';
import { tsChat, tsGemini, tsMessages, tsResponses } from './renderers/typescript.js';
import { mediaImageCs, mediaVideoCs } from './renderers/media/csharp.js';
import { mediaImageCurl, mediaVideoCurl } from './renderers/media/curl.js';
import { mediaImageGo, mediaVideoGo } from './renderers/media/go.js';
import { mediaImageJava, mediaVideoJava } from './renderers/media/java.js';
import { mediaImagePy, mediaVideoPy } from './renderers/media/python.js';
import { mediaImageRuby, mediaVideoRuby } from './renderers/media/ruby.js';
import { mediaImageTs, mediaVideoTs } from './renderers/media/typescript.js';

export function generateCode(
  proto: CodeProto,
  lang: CodeLang,
  ctx: CodeGenCtx,
): string {
  // Gemini：python/js 用官方 google-genai / @google/genai SDK；其余语言无官方 SDK → 原生 REST。
  if (proto === 'gemini') {
    if (lang === 'python') return pyGemini(ctx);
    if (lang === 'javascript') return tsGemini(ctx);
    if (lang === 'ruby') return rubyGemini(ctx);
    if (lang === 'go') return goRaw(proto, ctx);
    if (lang === 'java') return javaRaw(proto, ctx);
    if (lang === 'csharp') return csRaw(proto, ctx);
    if (lang === 'curl') return curl(proto, ctx);
    return curl(proto, ctx);
  }
  if (lang === 'python')
    return proto === 'chat'
      ? pyChat(ctx)
      : proto === 'messages'
        ? pyMessages(ctx)
        : pyResponses(ctx);
  if (lang === 'javascript')
    return proto === 'chat'
      ? tsChat(ctx)
      : proto === 'messages'
        ? tsMessages(ctx)
        : tsResponses(ctx);
  if (lang === 'go') return proto === 'chat' ? goChat(ctx) : goRaw(proto, ctx);
  if (lang === 'java') return javaRaw(proto, ctx);
  if (lang === 'csharp') return csRaw(proto, ctx);
  if (lang === 'ruby')
    return proto === 'chat'
      ? rubyChat(ctx)
      : proto === 'messages'
        ? rubyMessages(ctx)
        : rubyResponses(ctx);
  if (lang === 'curl') return curl(proto, ctx);
  return '';
}

/**
 * 生成媒体（文生图 / 文生视频）请求代码（统一 Task 对象，见 docs endpoints-discovery）。
 * 图：单段 POST /ai/v1/images/generations（sync 阻塞，结果在 output[]）。
 * 视频：提交 POST /ai/v1/videos + 轮询 GET /ai/v1/videos/{id} + 下载 content_url 三段。
 */
export function generateMediaCode(opts: MediaCodeGenOpts): string {
  const { modality, lang } = opts;
  const prompt = opts.prompt.trim() || MEDIA_PLACEHOLDER;
  const params = filterParams(opts.params);
  const ctx = buildMediaCtx(opts, prompt, params);

  if (modality === 'image') {
    if (lang === 'python') return mediaImagePy(ctx);
    if (lang === 'javascript') return mediaImageTs(ctx);
    if (lang === 'go') return mediaImageGo(ctx);
    if (lang === 'java') return mediaImageJava(ctx);
    if (lang === 'csharp') return mediaImageCs(ctx);
    if (lang === 'ruby') return mediaImageRuby(ctx);
    // curl（含其他未知 lang 回退）
    return mediaImageCurl(ctx);
  }

  // video
  if (lang === 'python') return mediaVideoPy(ctx);
  if (lang === 'javascript') return mediaVideoTs(ctx);
  if (lang === 'go') return mediaVideoGo(ctx);
  if (lang === 'java') return mediaVideoJava(ctx);
  if (lang === 'csharp') return mediaVideoCs(ctx);
  if (lang === 'ruby') return mediaVideoRuby(ctx);
  return mediaVideoCurl(ctx);
}
