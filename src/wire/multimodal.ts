/**
 * multimodal —— 多模态输入（图/音/视频）的协议无关 wire 工具集。
 *
 * 运行时（消费端的真实请求）与代码生成共用，保证「真实调用 == 复制代码」：唯一差异是 codegen
 * 传 { truncate:true } 把 base64 换成自文档化占位符 `<YOUR_BASE64_IMAGE|AUDIO|VIDEO>`，
 * 运行时传完整 base64。
 *
 * 各协议 × 模态的 wire 形态与「哪些支持」集中在 mediaSupported（唯一真源）+ buildMediaContent：
 *  · chat（OpenAI）      图 image_url；音 input_audio(仅 base64,wav/mp3)；视频不支持
 *  · messages（Anthropic）图 image(base64|url)；音/视频不支持
 *  · responses（OpenAI）  图 input_image；音/视频不支持（v1）
 *  · gemini              图/音/视频：base64→inlineData、url→fileData（含 YouTube）
 * 不支持的模态**静默降级**（buildMediaContent 跳过、不下发）。
 *
 * ⚠️ 只搬了纯 wire 部分。playground 原 lib/multimodal.ts 里读 File / FileReader / Blob / atob /
 * fetch 的输入侧工具（fileToImagePart、imagePartToBlob、urlToImagePart、parseChatImages…）留在 app：
 * 那些依赖浏览器全局，与「包必须 isomorphic、能被 node 里的预渲染脚本 require」冲突，
 * 且它们是输入采集的职责，不是 codegen 的。
 */
import type { CodeProto, ImagePart, Modality } from '../types.js';
import { BASE64_PLACEHOLDER } from '../config/placeholders.js';

/** 按模态取 base64 截断占位符（Get Code 可读；音视频 base64 巨大，必须占位）。 */
export function placeholderFor(modality: Modality): string {
  return modality === 'audio'
    ? '<YOUR_BASE64_AUDIO>'
    : modality === 'video'
      ? '<YOUR_BASE64_VIDEO>'
      : BASE64_PLACEHOLDER;
}

/** 拆 data URI → { media_type, data }（Anthropic base64 source 用）。非 data URI 兜底。 */
export function splitDataUri(src: string): { media_type: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
  if (m) return { media_type: m[1], data: m[2] };
  return { media_type: 'image/png', data: src };
}

/**
 * refImages（按 mediaRefFields key 存的源图）→ wire 请求体字段。运行时与代码生成共用，
 * 唯一差异是 partToStr（codegen 传占位符版本，运行时传真实 src），与本文件顶部的 truncate 模式一致。
 *
 * · `frame_images:first_frame` / `frame_images:last_frame`（虚拟槽）→ 折叠成一个
 *   `frame_images: [{frame_type, image_url:{url}}]`（first 排前，网关真实 schema 要求的结构化对象数组，
 *   不是裸串）。
 * · `input_references:image_url` / `:video_url` / `:audio_url`（虚拟槽，一类素材一个槽）→ 折叠成一个
 *   `input_references: [{type, url}]`，顺序按 schema 的 enum 顺序（图→视频→音频）。素材类型取自槽名，
 *   不从文件推断：签名链接常常不带扩展名，推断必错。裸 `input_references`（老 schema 无 type enum，
 *   playground 退回单图槽）仍按 image_url 处理。
 * · 其余 key → 原样：单图裸串，多图串数组。
 */
/** input_references 各素材类型的下发顺序，与 schema items.properties.type.enum 一致。 */
const REF_TYPE_ORDER = ['image_url', 'video_url', 'audio_url'];

export function refImagesToWireFields(
  refImages: Record<string, ImagePart[]>,
  partToStr: (p: ImagePart) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const frames: Array<{ frame_type: 'first_frame' | 'last_frame'; image_url: { url: string } }> = [];
  const refsByType: Record<string, string[]> = {};

  for (const [k, parts] of Object.entries(refImages)) {
    if (!parts?.length) continue;
    if (k === 'frame_images:first_frame' || k === 'frame_images:last_frame') {
      const frame_type = k === 'frame_images:first_frame' ? 'first_frame' : 'last_frame';
      frames.push({ frame_type, image_url: { url: partToStr(parts[0]) } });
      continue;
    }
    if (k === 'input_references' || k.startsWith('input_references:')) {
      const type = k.slice('input_references:'.length) || 'image_url';
      (refsByType[type] ??= []).push(...parts.map(partToStr));
      continue;
    }
    out[k] = parts.length === 1 ? partToStr(parts[0]) : parts.map(partToStr);
  }

  if (frames.length) {
    const rank = (f: (typeof frames)[number]) => (f.frame_type === 'first_frame' ? 0 : 1);
    frames.sort((a, b) => rank(a) - rank(b));
    out.frame_images = frames;
  }

  const typeKeys = Object.keys(refsByType);
  if (typeKeys.length) {
    // enum 顺序（图→视频→音频）；enum 之外的类型排在后面，保持稳定输出而不是丢掉
    const rank = (t: string) => {
      const i = REF_TYPE_ORDER.indexOf(t);
      return i < 0 ? REF_TYPE_ORDER.length : i;
    };
    out.input_references = typeKeys
      .sort((a, b) => rank(a) - rank(b))
      .flatMap((type) => refsByType[type].map((url) => ({ type, url })));
  }

  return out;
}

/** base64 part 的 src（整段 data URI）：截断时换成占位符 data URI，否则原样。 */
function srcForEmit(part: ImagePart, truncate: boolean): string {
  if (part.kind === 'url') return part.src;
  if (!truncate) return part.src;
  return `data:${part.mime || 'image/png'};base64,${placeholderFor(part.modality)}`;
}

/** base64 data 段（去掉 data: 前缀）：截断→占位符，否则真数据。 */
function dataForEmit(part: ImagePart, truncate: boolean): string {
  return truncate ? placeholderFor(part.modality) : splitDataUri(part.src).data;
}

/** OpenAI chat input_audio 的 format：仅支持 wav/mp3；其它 → null（降级）。 */
function chatAudioFormat(mime: string): 'wav' | 'mp3' | null {
  const m = (mime || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return null;
}

/**
 * 协议 × 模态 × kind 是否支持下发（唯一真源；buildMediaContent 与 UI 提示共用）。
 *  · image：四协议都支持（base64/url）。
 *  · gemini：图/音/视频、base64/url 皆可。
 *  · chat：音频仅 base64（OpenAI 无 url audio）；视频不支持。
 *  · messages/responses：音视频不支持。
 * 注：chat 音频还需 mime 为 wav/mp3（格式门控在 buildMediaContent/unsupportedForProto 里判）。
 */
export function mediaSupported(proto: CodeProto, modality: Modality, kind: 'base64' | 'url'): boolean {
  if (modality === 'image') return true;
  if (proto === 'gemini') return true;
  if (proto === 'chat' && modality === 'audio') return kind === 'base64';
  return false;
}

/** 当前协议不会下发的 part（模态/kind 不支持，或 chat 音频非 wav/mp3）——驱动 UI「不会发送」提示。 */
export function unsupportedForProto(proto: CodeProto, parts: ImagePart[]): ImagePart[] {
  return parts.filter((p) => {
    if (!mediaSupported(proto, p.modality, p.kind)) return true;
    if (proto === 'chat' && p.modality === 'audio' && p.kind === 'base64' && !chatAudioFormat(p.mime))
      return true;
    return false;
  });
}

/**
 * 按协议把「文本 + 媒体附件」拼成 user 消息的 content 数组（图/音/视频）。
 * 当前协议不支持的 part 静默跳过（降级）。无附件时调用方应走纯文本路径。
 * @param truncate codegen 用：把 base64 数据换成模态占位符，保持代码可读。
 */
export function buildMediaContent(
  proto: CodeProto,
  text: string,
  parts: ImagePart[],
  opts?: { truncate?: boolean },
): unknown[] {
  const truncate = !!opts?.truncate;
  const out: unknown[] = [];
  const usable = parts.filter((p) => mediaSupported(proto, p.modality, p.kind));

  if (proto === 'messages') {
    if (text) out.push({ type: 'text', text });
    for (const p of usable) {
      // messages 仅 image
      if (p.kind === 'url') out.push({ type: 'image', source: { type: 'url', url: p.src } });
      else {
        const { media_type } = splitDataUri(p.src);
        out.push({ type: 'image', source: { type: 'base64', media_type, data: dataForEmit(p, truncate) } });
      }
    }
    return out;
  }

  if (proto === 'responses') {
    if (text) out.push({ type: 'input_text', text });
    for (const p of usable) out.push({ type: 'input_image', image_url: srcForEmit(p, truncate) });
    return out;
  }

  if (proto === 'gemini') {
    // Gemini 原生 parts：文本 {text}；base64→{inlineData:{mimeType,data}}；url→{fileData:{mimeType,fileUri}}（含 YouTube）。
    if (text) out.push({ text });
    for (const p of usable) {
      if (p.kind === 'url') out.push({ fileData: { mimeType: p.mime, fileUri: p.src } });
      else out.push({ inlineData: { mimeType: splitDataUri(p.src).media_type, data: dataForEmit(p, truncate) } });
    }
    return out;
  }

  // chat（OpenAI chat completions）：图 image_url；音 input_audio(仅 base64 wav/mp3)。
  if (text) out.push({ type: 'text', text });
  for (const p of usable) {
    if (p.modality === 'audio') {
      const format = chatAudioFormat(p.mime);
      if (!format) continue; // 非 wav/mp3 → 降级
      out.push({ type: 'input_audio', input_audio: { data: dataForEmit(p, truncate), format } });
    } else {
      out.push({ type: 'image_url', image_url: { url: srcForEmit(p, truncate) } });
    }
  }
  return out;
}
