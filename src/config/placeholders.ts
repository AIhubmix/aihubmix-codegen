/**
 * 占位文案。
 *
 * 这里**没有默认 base URL**：base 由调用方经 `ctx.baseUrl` 注入（必填），理由见
 * types.ts 的 CodeGenCtx.baseUrl 注释 —— 双域构建 + verify 脚本后处理换域两笔账。
 */

/**
 * API key 占位符 —— 唯一真源（原先字面量在各 renderer 里散了 ≈40 处）。
 *
 * 两处 curl（文本协议与媒体）都出 `$AIHUBMIX_API_KEY`（shell 变量，粘进终端会展开），
 * 不出字面量 —— curl 是唯一「复制即跑」的语言，出字面量等于要用户把真 key 打进 shell 历史。
 * 其余六门语言各自决定怎么写（`os.environ` / `process.env` / 字面量），不强求统一。
 */
export const API_KEY_PLACEHOLDER = 'AIHUBMIX_API_KEY';

/** codegen 里 base64 附件的截断占位符（图）。音/视频用 placeholderFor(modality)。 */
export const BASE64_PLACEHOLDER = '<YOUR_BASE64_IMAGE>';

/** 媒体占位 prompt（未输入时让代码示例可读） */
export const MEDIA_PLACEHOLDER = 'A serene mountain lake at sunset';
