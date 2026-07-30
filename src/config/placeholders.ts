/**
 * 占位文案。
 *
 * 这里**没有默认 base URL**：base 由调用方经 `ctx.baseUrl` 注入（必填），理由见
 * types.ts 的 CodeGenCtx.baseUrl 注释 —— 双域构建 + verify 脚本后处理换域两笔账。
 */

/**
 * API key 占位符 —— 唯一真源（原先字面量在各 renderer 里散了 ≈40 处）。
 *
 * ⚠️ 现存不一致（本步不改，因为要求零字节差异；记账留给后续）：文本协议的 curl 出的是
 * `Bearer AIHUBMIX_API_KEY`（字面量，粘到终端不会展开），媒体 curl 出的是 `$AIHUBMIX_API_KEY`
 * （shell 变量，会展开）。统一成后者需要改产物字节，得单独一步做。
 */
export const API_KEY_PLACEHOLDER = 'AIHUBMIX_API_KEY';

/** codegen 里 base64 附件的截断占位符（图）。音/视频用 placeholderFor(modality)。 */
export const BASE64_PLACEHOLDER = '<YOUR_BASE64_IMAGE>';

/** 媒体占位 prompt（未输入时让代码示例可读） */
export const MEDIA_PLACEHOLDER = 'A serene mountain lake at sunset';
