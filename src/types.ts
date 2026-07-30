/**
 * 包的公共类型。
 *
 * 归属反转说明：CodeProto / CodeLang 原本住在 playground 的 `@/store/configStore`,
 * 等于「包 import app 的 store」。搬包后由包 own,app 从包 re-export。
 *
 * ToolCall / ImagePart / EndpointMeta 在两个消费端各有更宽的定义(带 React render props、
 * 带完整 endpoint 元信息)。这里只声明 codegen 真正读到的字段,消费端的宽类型结构上可赋值过来,
 * 不需要改它们 —— 也避免把 React 类型拖进包(包必须能在 node 里被 require)。
 */

/** 协议 id */
export type CodeProto = 'chat' | 'messages' | 'responses' | 'gemini';

/** 语言 id */
export type CodeLang = 'python' | 'javascript' | 'go' | 'java' | 'csharp' | 'ruby' | 'curl';

/** 语言列表项。UI 只用 id/label；其余字段供 verify harness 落盘与运行时探测。 */
export interface LangDef {
  id: CodeLang;
  label: string;
  /** 源文件扩展名（含点）。 */
  ext: string;
  /** 固定文件名（java 的 Main.java / csharp 的 Program.cs）；缺省则由 harness 按 ext 起名。 */
  fileName?: string;
  /** 运行时探测命令：真跑一次拿退出码，不用 `command -v`（会被 macOS 的 java stub 骗过）。 */
  probe: { cmd: string; args: string[] } | null;
  /** 跑通该语言全部协议示例所需的 SDK 安装命令；null = 标准库即可。 */
  install: string | null;
}

/** 协议列表项 */
export interface ProtoDef {
  id: CodeProto;
  label: string;
}

/** 工具定义（parameters 是 JSON Schema 字符串，由用户在编辑器里填）。 */
export interface ToolDef {
  name: string;
  description?: string;
  /** 参数 JSON Schema（以字符串存储，编辑器里编辑；下发前 JSON.parse，空/非法回退空 object）。 */
  parameters?: string;
}

/** 结构化输出配置 */
export interface StructuredCfg {
  format: string;
  name: string;
  schema: string;
}

/**
 * 多模态附件。
 *  · kind='base64' → src 为 data URI（data:<mime>;base64,xxx）
 *  · kind='url'    → src 为 http(s) 链接
 *  · modality      → image/audio/video，决定各协议 wire 形态（buildMediaContent 分发 + 降级）
 */
export interface ImagePart {
  id: string;
  kind: 'base64' | 'url';
  /** data:<mime>;base64,xxx 或 http(s) URL */
  src: string;
  /** image/png、audio/wav、video/mp4 等 */
  mime: string;
  /** 媒体模态 */
  modality: 'image' | 'audio' | 'video';
  name?: string;
}

/** 媒体模态别名（multimodal 内部用）。 */
export type Modality = ImagePart['modality'];

/** 工具调用（codegen 只读 id/name/args/argsString；消费端的完整 ToolCall 结构上可赋值）。 */
export interface ToolCall {
  id: string;
  name: string;
  /** 兼容两种格式：Record 或 JSON 字符串 */
  args: Record<string, unknown> | string;
  /** 原始参数字符串（流式构建时用） */
  argsString?: string;
}

/** 媒体端点元信息（codegen 只读这几位；消费端的完整 EndpointMeta 可赋值）。 */
export interface EndpointMeta {
  path?: string;
  /** 'none' | 'input' */
  envelope?: string;
  pollPath?: string;
  /** wire 编码：'json'（默认，含 replicate input 信封）| 'multipart'（openai edits 二进制上传） */
  encoding?: 'json' | 'multipart';
}

/** 数值参数集合（来自参数面板） */
export interface CodeGenParams {
  max_tokens: number;
  temperature: number;
  top_p: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  [key: string]: number | undefined;
}

/** 会话消息（与 playground api/llm.ts 的 ChatMsg 同形）。 */
export interface CgMsg {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** 多模态附件（仅 user 消息）。 */
  images?: ImagePart[];
  /** assistant 发起的工具调用。 */
  toolCalls?: ToolCall[];
  /** tool 结果消息对应的调用 id。 */
  toolCallId?: string;
}

/** generateCode 的入参上下文 */
export interface CodeGenCtx {
  /**
   * 网关根地址，不带尾斜杠（如 `https://aihubmix.com` / `https://api.inferera.com`）。
   *
   * **必填是故意的**：inferera-web 是双域构建，写死在包里会让 inferera 域的详情页生成
   * 指向 aihubmix.com 的代码；verify 脚本原先靠 `code.replaceAll(...)` 后处理换域，
   * 意味着「被验证的字节 ≠ 用户拿到的字节」。必填让所有调用点编译报错，强制显式传。
   *
   * 也**不提供 setBaseUrl() 这类模块级 setter** —— 消费端后续按 Host 头运行时分叉双域，
   * 同进程并发服务两个域，模块级可变状态必然串。
   */
  baseUrl: string;
  model: { id: string };
  /** system prompt（空串视为无） */
  sys: string;
  /** user 首条消息内容（空时给占位）。仅在未提供 messages 时用于单条兜底。 */
  user: string;
  /** 末条 user 的图片附件（多模态）；提供时 buildBody 用截断占位符拼 content 数组。 */
  images?: ImagePart[];
  /** 完整会话历史（提供时 buildBody/代码渲染用它拼完整多轮消息，与真实请求同源）；
   *  为空则退回 sys+user 单条兜底（媒体 / 无对话）。 */
  messages?: CgMsg[];
  /** 模型是否输出图片（outMods 含 image）：chat 协议下据此下发 modalities:["text","image"]。 */
  imageOut?: boolean;
  /** 数值参数 */
  p: CodeGenParams;
  /** 该协议 schema 声明的参数键集合（数值+enum）。提供时 buildBody 只发集合内的可选数值参数，
   *  避免下发模型不支持的字段（如 schema 无 top_k 的模型不发 top_k）。省略=不门控（向后兼容）。 */
  paramKeys?: string[];
  /** enum/字符串参数取值（如 verbosity/service_tier/prompt_cache_retention），由参数面板配置。 */
  enums?: Record<string, string>;
  /** enum 参数的 schema 默认值；取值等于默认则不下发。 */
  enumDefaults?: Record<string, string>;
  /** 结构化参数取值（object/array/map，如 logit_bias/stop/metadata/prediction）。
   *  已是真实嵌套值（非 JSON 串）；buildBody 按 paramKeys 门控、跳过空 {}/[] 后原样下发。 */
  objects?: Record<string, unknown>;
  stream: boolean;
  /** 启用工具时传入；否则 null/undefined */
  tools?: ToolDef[] | null;
  /** tool_choice（仅在 tools 启用时随 tools 一起下发；auto=默认不发）。 */
  toolChoice?: { mode: 'auto' | 'none' | 'required' | 'tool'; name?: string };
  /** 启用 thinking */
  think?: boolean;
  /** 思考等级（reasoning_effort enum 值，来自模型 schema；messages 非 adaptive 时走预算档换算）。 */
  thinkLevel?: string;
  /** messages 是否走 adaptive thinking：true 则下发 thinking:{type:'adaptive'} + output_config.effort
   *  = thinkLevel；false/未提供则维持 thinking:{type:'enabled'} 形态。非 messages 协议忽略此字段。 */
  thinkAdaptive?: boolean;
  /** 显式缓存（messages/anthropic）：开启时在 system（或末条消息内容块）打 cache_control 断点。
   *  非 messages 协议为隐式缓存，无需任何字段，故此标记仅 messages 生效。 */
  cache?: boolean;
  /** provider 侧联网搜索（chat 下发 web_search_options:{}）。 */
  webSearch?: boolean;
  /** 启用结构化输出时传入；否则 null/undefined */
  structured?: StructuredCfg | null;
}

/** generateMediaCode 的入参 */
export interface MediaCodeGenOpts {
  /** 网关根地址，不带尾斜杠。必填，理由同 CodeGenCtx.baseUrl。 */
  baseUrl: string;
  /** 媒体模态：图 or 视频 */
  modality: 'image' | 'video';
  /** 模型 ID */
  modelId: string;
  /** 用户输入的 prompt（空时给占位） */
  prompt: string;
  /** 表单取值。过滤掉 undefined / 空串，保留有效参数。 */
  params: Record<string, unknown>;
  /** 当前协议 endpoint（path/envelope/encoding；缺省退默认图/视频端点） */
  endpoint?: EndpointMeta;
  /** x-media-ref 源图（按字段 key；folded 进 JSON body 或 multipart） */
  refImages?: Record<string, ImagePart[]>;
  /** 语言 */
  lang: CodeLang;
}
