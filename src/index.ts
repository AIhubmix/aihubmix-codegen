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
export { LANGS, langDef } from './config/languages.js';
export { AUTH_HEADERS, PROTOCOLS, PROTO_ROUTES, UPSTREAM } from './config/protocols.js';
export { API_KEY_PLACEHOLDER } from './config/placeholders.js';
export { SDK, sdkDef, type SdkDef } from './config/sdk.js';
export { ENDPOINT_TO_PROTO, KIND_TO_PROTO, protosFromEndpoints } from './config/vocab.js';

// ---- wire 层（真实请求与 codegen 共用）----
export { authHeaders } from './wire/auth.js';
export { buildBody } from './wire/body.js';
export { CAPABILITIES, CAP_GATED_WIRE_KEYS, type CapabilityDef } from './wire/capabilities.js';
export { endpointPath } from './wire/endpoint.js';
export { buildMessages } from './wire/messages.js';
export { parseSchemaSafe, parseToolCallArgs } from './wire/schema.js';
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

// ---- 这里曾经还有一层「能力注入层」（generateFromCapabilities / CAPABILITY_PUTS /
//      verdict 策略表 / 按能力名索引的示例值）。它说的是 canon 词汇（能力键、verdict），
//      是开集、每周在长；留在这里意味着 canon 每加一条能力这个包就要发版。已整体搬去
//      @aihubmix/model-schema，那个包依赖本包（方向单向：canon 词汇 → wire 词汇）。
//      本包从此只认识 wire 与语言，公共入参 CodeGenCtx 里一个 canon 词都没有
//      —— 这条由 tests/vocabulary-isolation.test.ts 机器守着。
