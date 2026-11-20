# Changelog

本文件自 0.1.3 起维护；更早版本（0.1.0–0.1.2）的记录见 git commit message。
发版流程（人工）：bump `package.json` → 更新本文件 → `pnpm test:all` → `npm publish` → 打 tag `v<version>`。

## 0.5.0 — 2026-11-19

- **新增 Gemini Live（原生 BidiGenerateContent WebSocket）代码生成**（TASK-9Y24X9）：独立入口 `generateGeminiLiveCode(opts)`，与 OpenAI realtime 的 `generateRealtimeCode` 是两套线协议（握手路径、`setup` 首帧、16kHz `realtimeInput.audio`），不复用其 builder / 渲染器。
- 同源缝出口：`geminiLiveWsUrl` / `buildGeminiLiveSetup` / `buildGeminiLiveCtx`，以及输入帧 `geminiLiveAudioFrame` / `geminiLiveVideoFrame` / `geminiLiveTextFrame` / `geminiLiveAudioStreamEnd`。消费端真实 WS 客户端必须走它们。
- `setup` 形态（aihubmix.com 生产实测 gemini-3.8-live / gemini-2.5-flash-live）：
  - 回复只有两种：`output:'audio'`（缺省，`responseModalities:["AUDIO"]`，文字走 `outputAudioTranscription`）与 `output:'avatar'`（恰为 `["VIDEO"]` + `avatarConfig.avatarName`，下行为单条 fMP4，H.264 + AAC 同流）。**不提供 `["TEXT"]`**：两个模型都会被上游 1007 关会话。
  - 转写缺省开（`transcripts:false` 关）；`voice` / `instructions` / `mediaResolution` 空则不拼；`maxOutputTokens` 不拼（网关缺省 2048）；`avatarName` 空回落 `GL_AVATARS[0]`。
- 常量：`GL_PATH` / `GL_INPUT_RATE` / `GL_INPUT_AUDIO_MIME` / `GL_OUTPUT_RATE` / `GL_VIDEO_MIME` / `GL_VIDEO_FPS` / `GL_VIDEO_MAX_EDGE` / `GL_AVATAR_MIME` / `GL_AVATARS`（实测可用 Jay / Ben）/ `GL_CHUNK_MS`。
- 语言矩阵：python（websockets）/ typescript（node ws）精品格；curl 出 wscat 说明；go / java / csharp / ruby 为降级注释块。python / typescript 生成物已对 aihubmix.com 生产真跑（语音、数字人各一轮）。
- 示例时序（审查修正）：typescript 串行消费下行消息，回复分片按到达顺序落盘，队列写完才关文件；摄像头帧与音频在 `setupComplete` 后并发发送，会话关闭即停发；两种语言都在连接前读取输入文件，缺文件直接报错退出，不再挂住会话。`tests/gemini-live-run.test.ts` 用假 ws 真跑 typescript 产物锁住这三点。
- 门禁：`tests/gemini-live.test.ts`（URL、setup 红线、输入帧、7 语言 × 两种回复防伪、换 base 逐字）；`fact-localization` 增 `BidiGenerateContent` 棘轮；逃逸脚本增 gemini-live python / javascript 真语法校验（EVIL 经 instructions / voice / avatarName 注入）。

## 0.4.1 — 2026-11-13

- **`CodeGenParams.max_tokens` 改为可选，缺省 = 不下发上限**（TASK-CZ5KYA，playground 基础模式）：schema 未收录的新模型上限未知，调用方不传 `max_tokens` 时 chat 不带 `max_tokens` / `max_completion_tokens`、responses 不带 `max_output_tokens`，交给上游默认；messages 因 Anthropic 硬性必填，缺省补 `MESSAGES_DEFAULT_MAX_TOKENS`（4096）。Go 渲染器同口径省略 `MaxTokens` / `MaxCompletionTokens` 字段。传了上限的调用方行为不变。
- 门禁：`tests/basic-mode.test.ts`（三协议缺省形状、给值不回归、Go 不渲染上限字段、7 语言 × 三协议示例不含 `undefined`）。

## 0.4.0 — 2026-10-09

- **新增 OpenAI Decisions（`POST /v1/decisions`）代码生成**：独立入口 `generateOpenAIDecisionCode(opts)`，与 `/v1/systemone` 的 `generateDecisionCode` 是两个端点、两张渲染器表（body 形状、题型名、答案形状都不同），不进 `CodeProto` 词表。
- 同源缝出口：`buildOpenAIDecisionBody(opts)` / `buildOpenAIDecisionCtx(opts)` —— body 为 `{ model, input, questions }`；可选的 `name` 空值不下发，上游必填的 `instructions` / `choices` / `levels` 只在没提供时不下发（空串、空数组原样交给上游校验）；input / questions 缺省退占位模板（客服反馈分诊：predicate / choice / score 各一题）；返回值是过一遍 JSON 序列化的发上线形态，SDK 两格不会把嵌套 `undefined` 写成 `None` / `null`。消费端真实请求必须走它。
- 语言矩阵：python / typescript 走官方 SDK `client.decisions.create`（首行注释写明版本下限 openai-python 3.26.0 / openai-node 7.30.0），go / java / csharp / ruby / curl 走原生 HTTP。
- 类型：`OpenAIDecisionCodeGenOpts` / `OpenAIDecisionQuestion` / `OpenAIDecisionMessage` / `OpenAIDecisionInputPart`；常量 `OPENAI_DECISION_PATH` / `OPENAI_DECISION_TYPES` / `OPENAI_DECISION_SDK` / 两个占位模板。
- 门禁：`tests/openai-decision.test.ts`（body 形状、空值、同源缝含 python kwargs / TS 对象字面量逐字比对与 TS 字面量求值后对 curl JSON 严格比对、两个 decision 面互不串味）；baseurl / output-language 按表补分支；`vocabulary-isolation` 的 canon 协议 id 补 `openai.decisions`；`fact-localization` 增「decision 路由」棘轮（`/v1/systemone`、`/v1/decisions` 只准住 config）；逃逸脚本增 py / js / rb 真语法校验（文本与消息两种 input）、python `create(...)` 关键字参数 `ast.literal_eval` 后对 builder 逐字比对、java 文本块与 curl `-d` 段逐字还原、go 标准库 `go build`。
- 内部：「没填」判据 `isUnset` 移到 `wire/gate.ts`，两个 decision 面共用（`/v1/systemone` 行为不变）。

## 0.1.3 — 2026-09-16

- **新增 realtime 转录（WebSocket 双向流）代码生成**：独立入口 `generateRealtimeCode(opts)`（照 media 先例，不进 `CodeProto` 词表——realtime 是第二种传输形态，不是第五个 HTTP 协议）。
- 同源缝出口：`realtimeWsUrl(baseUrl, modelId)`（握手 URL，https→wss，query 必带 intent/model）与 `buildRealtimeSession(opts)`（session.update 首帧）。消费端真实 WS 客户端必须走这两个函数，与 `buildBody` 对四协议的地位相同。
- 语言矩阵（a-lite 首发）：python（原生 websockets）/ typescript（node ws）精品格；curl 格出 wscat 连通性说明；go/java/csharp/ruby 为可行动的降级注释块（不空、不冒充 HTTP），完整模板后补。
- 防伪门禁：`tests/realtime.test.ts` 每格正向断 wss 握手 URL、反向断 HTTP 调用指纹；`fact-localization` FACTS 增 `/v1/realtime` 棘轮；逃逸脚本增 realtime python/javascript 真语法校验（EVIL 串经 prompt/keywords 注入）。
