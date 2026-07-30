/**
 * 媒体请求上下文：endpoint 归一 + 源图折叠。
 *
 * 与消费端真实请求（playground api/media.ts buildRequest）同规则，保证「真实请求 == Get Code」。
 */
import type { ImagePart, MediaCodeGenOpts } from '../types.js';
import { IMG_PATH_DEFAULT, VID_PATH_DEFAULT } from '../config/media.js';
import { placeholderFor, refImagesToWireFields } from './multimodal.js';

/** 媒体请求上下文（endpoint 归一 + 源图折叠），贯穿各语言生成函数。 */
export interface MediaCtx {
  /** 网关根地址（从 MediaCodeGenOpts 透传，各语言 renderer 拼 URL 用）。 */
  baseUrl: string;
  submitPath: string;
  pollPath: string;
  envelope: string; // 'none' | 'input'
  encoding: 'json' | 'multipart';
  /** JSON body（含 model/prompt/params/源图串，已按 envelope 包裹） */
  bodyObj: Record<string, unknown>;
  /** multipart 字段（key → 值/占位；源图值为 <file> 占位标记） */
  multipartFields: { key: string; value: string; isFile: boolean }[];
  /** 是否有源图 */
  hasRef: boolean;
}

/** 过滤掉 undefined / 空串的 params，仅保留有意义的键 */
export function filterParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== '',
    ),
  );
}

/** 源图 → JSON 字符串（url 原样；base64 用占位符，保持代码可读；与 api/media.ts imagePartToWireString 同义）。 */
function refToWireStr(p: ImagePart): string {
  return p.kind === 'url' ? p.src : `data:${p.mime || 'image/png'};base64,${placeholderFor(p.modality)}`;
}

/** 源图折叠成 JSON 字段：与 api/media.ts buildRequest 同规则（frame_images/input_references 结构化对象数组，
 *  其余单图为串、多图为串数组），见 refImagesToWireFields。 */
function refWireParams(refImages?: Record<string, ImagePart[]>): Record<string, unknown> {
  return refImagesToWireFields(refImages ?? {}, refToWireStr);
}

/** 组装媒体请求上下文：解析 endpoint（path/envelope/encoding），构造 JSON body 与 multipart 字段。
 *  与 api/media.ts buildRequest 同规则，保证「真实请求 == Get Code」。 */
export function buildMediaCtx(
  opts: MediaCodeGenOpts,
  prompt: string,
  params: Record<string, unknown>,
): MediaCtx {
  const { baseUrl, modality, modelId, endpoint, refImages } = opts;
  const submitPath = endpoint?.path || (modality === 'image' ? IMG_PATH_DEFAULT : VID_PATH_DEFAULT);
  const pollPath = endpoint?.pollPath || (modality === 'video' ? `${VID_PATH_DEFAULT}/{id}` : '');
  const envelope = endpoint?.envelope ?? 'none';
  const encoding = endpoint?.encoding ?? 'json';
  const refStrs = refWireParams(refImages);
  const hasRef = Object.keys(refStrs).length > 0;

  // JSON body：input 信封（replicate，无 model）vs 扁平（含 model）
  const fields = { prompt, ...params, ...refStrs };
  const bodyObj: Record<string, unknown> =
    envelope === 'input' ? { input: fields } : { model: modelId, ...fields };

  // multipart 字段：model + 标量 + 每个源图 key（值为 <file> 占位）
  const multipartFields: MediaCtx['multipartFields'] = [
    { key: 'model', value: modelId, isFile: false },
    { key: 'prompt', value: prompt, isFile: false },
    // 复合值（object/array）JSON 序列化，与 api/media.ts buildRequest 同规则，
    // 否则 String({}) 产出 "[object Object]"，Get Code 与真实请求不一致。
    ...Object.entries(params).map(([k, v]) => ({
      key: k,
      value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
      isFile: false,
    })),
    ...Object.entries(refImages ?? {})
      .filter(([, parts]) => parts?.length)
      .flatMap(([k, parts]) => parts.map(() => ({ key: k, value: '', isFile: true }))),
  ];

  return { baseUrl, submitPath, pollPath, envelope, encoding, bodyObj, multipartFields, hasRef };
}

/** multipart 字段拆成 data（标量）+ files（源图）两组，供 py/ts/curl 渲染。 */
export function splitMultipart(ctx: MediaCtx): { data: { key: string; value: string }[]; files: string[] } {
  const data = ctx.multipartFields.filter((f) => !f.isFile).map((f) => ({ key: f.key, value: f.value }));
  const files = ctx.multipartFields.filter((f) => f.isFile).map((f) => f.key);
  return { data, files };
}

/** multipart 端点在只做 JSON 渲染的语言里加一行提示注释（go/java/csharp/ruby）。 */
export function mpNote(ctx: MediaCtx, indent = '', prefix = '//'): string {
  return ctx.encoding === 'multipart'
    ? `${indent}${prefix} NOTE: this endpoint expects multipart/form-data (binary source image) — see the cURL or Python sample.\n`
    : '';
}
