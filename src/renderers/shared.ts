/**
 * 多模态：SDK 模板的 user content 字面量 + 占位符提示注释。
 * 各语言 renderer 共用。
 */
import type { CgMsg, CodeGenCtx, CodeProto } from '../types.js';
import { jsLiteral, pyLiteral, rbLiteral } from '../emit/literal.js';
import { buildMessages } from '../wire/messages.js';
import { mediaSupported, placeholderFor } from '../wire/multimodal.js';

export function hasImages(ctx: CodeGenCtx): boolean {
  return !!(ctx.images && ctx.images.length);
}

/** 完整消息数组的语言字面量（chat/messages→messages、responses→input、gemini→contents）。
 *  与 buildBody/真实请求同源：都走 buildMessages（图片截断）。ctx.messages 缺失时退回 sys+user 单条。 */
export function messagesLiteral(
  proto: CodeProto,
  ctx: CodeGenCtx,
  lang: 'python' | 'js' | 'ruby',
  pad: string,
): string {
  const msgs: CgMsg[] =
    ctx.messages && ctx.messages.length
      ? ctx.messages
      : [{ role: 'user', content: ctx.user, ...(hasImages(ctx) ? { images: ctx.images } : {}) }];
  const arr = buildMessages(proto, msgs, ctx.sys, { cache: ctx.cache, truncate: true });
  return lang === 'python' ? pyLiteral(arr, pad) : lang === 'js' ? jsLiteral(arr, pad) : rbLiteral(arr, pad);
}

/** 当前 ctx 里「该协议会下发的」base64 附件去重占位符（图/音/视频）——降级掉的不列，与代码体一致。 */
export function mediaPlaceholders(ctx: CodeGenCtx, proto: CodeProto): string[] {
  if (!hasImages(ctx)) return [];
  const mods = new Set(
    ctx
      .images!.filter((i) => i.kind === 'base64' && mediaSupported(proto, i.modality, i.kind))
      .map((i) => i.modality),
  );
  return [...mods].map(placeholderFor);
}

/** 含 base64 媒体时在代码顶部加一行注释，提示替换占位符（仅列该协议实际下发的模态）。 */
export function imageNote(ctx: CodeGenCtx, lang: 'python' | 'js', proto: CodeProto): string {
  const ph = mediaPlaceholders(ctx, proto);
  if (!ph.length) return '';
  const c = lang === 'python' ? '#' : '//';
  return `${c} Replace ${ph.join(' / ')} with your base64-encoded media data\n`;
}

/** 含 base64 图片时顶部加一行提示注释。 */
export function rubyImageNote(ctx: CodeGenCtx, proto: CodeProto): string {
  const ph = mediaPlaceholders(ctx, proto);
  if (!ph.length) return '';
  return `# Replace ${ph.join(' / ')} with your base64-encoded media data\n`;
}
