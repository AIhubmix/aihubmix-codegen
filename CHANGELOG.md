# Changelog

本文件自 0.1.3 起维护；更早版本（0.1.0–0.1.2）的记录见 git commit message。
发版流程（人工）：bump `package.json` → 更新本文件 → `pnpm test:all` → `npm publish` → 打 tag `v<version>`。

## 0.1.3 — 2026-09-16

- **新增 realtime 转录（WebSocket 双向流）代码生成**：独立入口 `generateRealtimeCode(opts)`（照 media 先例，不进 `CodeProto` 词表——realtime 是第二种传输形态，不是第五个 HTTP 协议）。
- 同源缝出口：`realtimeWsUrl(baseUrl, modelId)`（握手 URL，https→wss，query 必带 intent/model）与 `buildRealtimeSession(opts)`（session.update 首帧）。消费端真实 WS 客户端必须走这两个函数，与 `buildBody` 对四协议的地位相同。
- 语言矩阵（a-lite 首发）：python（原生 websockets）/ typescript（node ws）精品格；curl 格出 wscat 连通性说明；go/java/csharp/ruby 为可行动的降级注释块（不空、不冒充 HTTP），完整模板后补。
- 防伪门禁：`tests/realtime.test.ts` 每格正向断 wss 握手 URL、反向断 HTTP 调用指纹；`fact-localization` FACTS 增 `/v1/realtime` 棘轮；逃逸脚本增 realtime python/javascript 真语法校验（EVIL 串经 prompt/keywords 注入）。
