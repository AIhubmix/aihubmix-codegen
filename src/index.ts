/**
 * @aihubmix/codegen —— 唯一公共出口。
 *
 * 约束（写在这里，改动前先读）：
 * - **isomorphic**：无 DOM、无 window、无网络、无环境变量读取。必须能在 node 里被 require
 *   （inferera-web 的 prerender-models.js 是消费方之一）。
 * - **Get Code 与真实请求同源**：消费端发真实请求也要走 buildBody，不允许旁路拼 body。
 */

// ---- 类型 ----
export type {
  CgMsg,
  CodeGenCtx,
  CodeGenParams,
  CodeLang,
  CodeProto,
  EndpointMeta,
  ImagePart,
  LangDef,
  MediaCodeGenOpts,
  Modality,
  ProtoDef,
  StructuredCfg,
  ToolCall,
  ToolDef,
} from './types.js';

// ---- 配置词表 ----
export { LANGS } from './config/languages.js';
export { PROTOCOLS } from './config/protocols.js';
export { KIND_TO_PROTO } from './config/vocab.js';

// ---- wire 层（真实请求与 codegen 共用）----
export { buildBody } from './wire/body.js';
export { buildMessages } from './wire/messages.js';
export { parseToolCallArgs } from './wire/schema.js';
export {
  buildMediaContent,
  mediaSupported,
  placeholderFor,
  refImagesToWireFields,
  splitDataUri,
  unsupportedForProto,
} from './wire/multimodal.js';

// ---- 代码生成 ----
export { generateCode, generateMediaCode } from './generate.js';
