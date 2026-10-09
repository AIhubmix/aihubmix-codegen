# Changelog

本文件自 0.1.3 起维护；更早版本（0.1.0–0.1.2）的记录见 git commit message。
发版流程（人工）：bump `package.json` → 更新本文件 → `pnpm test:all` → `npm publish` → 打 tag `v<version>`。

## 0.4.0 — 2026-10-09

- **新增 OpenAI Decisions（`POST /v1/decisions`）代码生成**：独立入口 `generateOpenAIDecisionCode(opts)`，与 `/v1/systemone` 的 `generateDecisionCode` 是两个端点、两张渲染器表（body 形状、题型名、答案形状都不同），不进 `CodeProto` 词表。
- 同源缝出口：`buildOpenAIDecisionBody(opts)` / `buildOpenAIDecisionCtx(opts)` —— body 为 `{ model, input, questions }`，空值不下发、缺省退占位模板（客服反馈分诊：predicate / choice / score 各一题）；消费端真实请求必须走它。
- 语言矩阵：python / typescript 走官方 SDK `client.decisions.create`（首行注释写明版本下限 openai-python 3.26.0 / openai-node 7.30.0），go / java / csharp / ruby / curl 走原生 HTTP。
- 类型：`OpenAIDecisionCodeGenOpts` / `OpenAIDecisionQuestion` / `OpenAIDecisionMessage` / `OpenAIDecisionInputPart`；常量 `OPENAI_DECISION_PATH` / `OPENAI_DECISION_TYPES` / `OPENAI_DECISION_SDK` / 两个占位模板。
- 门禁：`tests/openai-decision.test.ts`（body 形状、空值、同源缝含 python kwargs / TS 对象字面量逐字比对、两个 decision 面互不串味）；baseurl / output-language 按表补分支；`vocabulary-isolation` 的 canon 协议 id 补 `openai.decisions`；`fact-localization` 增「decision 路由」棘轮（`/v1/systemone`、`/v1/decisions` 只准住 config）；逃逸脚本增 py / js / rb 真语法校验（文本与消息两种 input）、java 文本块与 curl `-d` 段逐字还原、go 标准库 `go build`。
- 内部：「没填」判据 `isUnset` 移到 `wire/gate.ts`，两个 decision 面共用（`/v1/systemone` 行为不变）。

## 0.1.3 — 2026-09-16

- **新增 realtime 转录（WebSocket 双向流）代码生成**：独立入口 `generateRealtimeCode(opts)`（照 media 先例，不进 `CodeProto` 词表——realtime 是第二种传输形态，不是第五个 HTTP 协议）。
- 同源缝出口：`realtimeWsUrl(baseUrl, modelId)`（握手 URL，https→wss，query 必带 intent/model）与 `buildRealtimeSession(opts)`（session.update 首帧）。消费端真实 WS 客户端必须走这两个函数，与 `buildBody` 对四协议的地位相同。
- 语言矩阵（a-lite 首发）：python（原生 websockets）/ typescript（node ws）精品格；curl 格出 wscat 连通性说明；go/java/csharp/ruby 为可行动的降级注释块（不空、不冒充 HTTP），完整模板后补。
- 防伪门禁：`tests/realtime.test.ts` 每格正向断 wss 握手 URL、反向断 HTTP 调用指纹；`fact-localization` FACTS 增 `/v1/realtime` 棘轮；逃逸脚本增 realtime python/javascript 真语法校验（EVIL 串经 prompt/keywords 注入）。
