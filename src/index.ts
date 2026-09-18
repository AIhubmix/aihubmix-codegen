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
  DecisionCodeGenOpts,
  DecisionQuestion,
  EndpointMeta,
  ImagePart,
  LangDef,
  MediaCodeGenOpts,
  Modality,
  ProtoDef,
  RealtimeCodeGenOpts,
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
// 消费端（playground 媒体提交）要和 filterParams 用同一份「空值」判据，否则真实请求与 Get Code 分叉
export { isEmptyContainer } from './wire/gate.js';
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
// realtime 同源缝：消费端真实 WS 客户端取握手 URL / 首帧配置必须走这几个函数。
// 对话（conversation）的首帧走 buildConversationSession（白名单，禁 transcription），
// 与转录的 buildRealtimeSession 两条独立 builder，绝不共用。
export {
  buildConversationSession,
  buildRealtimeSession,
  realtimeWsUrl,
  type RealtimeCtx,
} from './wire/realtime.js';
// decision 同源缝：消费端真实请求的 body 必须走 buildDecisionBody，不许旁路拼
// —— 否则「Get Code 里写的」与「点发送真发出去的」会各自演化。
export { buildDecisionBody, buildDecisionCtx, type DecisionCtx } from './wire/decision.js';
export {
  DECISION_PATH,
  DECISION_QUESTIONS_PLACEHOLDER,
  DECISION_STATE_PLACEHOLDER,
  DECISION_TYPES,
} from './config/decision.js';
export {
  RT_AUDIO_TYPE,
  RT_CHUNK_MS,
  RT_CONV_SESSION_TYPE,
  RT_DEFAULT_VOICE,
  RT_INTENT,
  RT_PATH,
  RT_SAMPLE_RATE,
} from './config/realtime.js';

// ---- 代码生成 ----
export {
  generateCode,
  generateDecisionCode,
  generateMediaCode,
  generateRealtimeCode,
} from './generate.js';

// ---- 这里曾经还有一层「能力注入层」（generateFromCapabilities / CAPABILITY_PUTS /
//      verdict 策略表 / 按能力名索引的示例值）。它说的是 canon 词汇（能力键、verdict），
//      是开集、每周在长；留在这里意味着 canon 每加一条能力这个包就要发版。已整体搬去
//      @aihubmix/model-schema，那个包依赖本包（方向单向：canon 词汇 → wire 词汇）。
//      本包从此只认识 wire 与语言，公共入参 CodeGenCtx 里一个 canon 词都没有
//      —— 这条由 tests/vocabulary-isolation.test.ts 机器守着。
