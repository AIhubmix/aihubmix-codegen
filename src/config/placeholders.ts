/**
 * 占位文案。
 *
 * 这里**没有默认 base URL**：base 由调用方经 `ctx.baseUrl` 注入（必填），理由见
 * types.ts 的 CodeGenCtx.baseUrl 注释 —— 双域构建 + verify 脚本后处理换域两笔账。
 */

/**
 * API key 环境变量名 —— 唯一真源（原先字面量在各 renderer 里散了 ≈40 处）。
 *
 * **七门语言全部从环境变量取 key，示例里不出任何字面量占位。**
 * 出字面量（`"AIHUBMIX_API_KEY"` / `<AIHUBMIX_API_KEY>`）等于教用户把真 key 打进源码
 * 和 shell 历史；环境变量形态则复制即跑（只要 `export AIHUBMIX_API_KEY=...` 过一次），
 * 也与 verify 真跑 harness 同一条注入通道（设同名 env，不做字节替换）。
 */
export const API_KEY_PLACEHOLDER = 'AIHUBMIX_API_KEY';

/**
 * 各语言「从环境变量取 key」的表达式。renderer 一律引用这张表，不自己拼 ——
 * 变量名只在本文件出现一次（fact-localization 测试锁着）。
 *
 * curl 是 shell 变量形态（粘进终端由 shell 展开）；其余六门是各语言的标准取法。
 * ruby 另有插值形态见 `RUBY_KEY_INTERP`（写进双引号字符串内部时用）。
 */
export const ENV_KEY_EXPR = {
  python: `os.environ["${API_KEY_PLACEHOLDER}"]`,
  javascript: `process.env.${API_KEY_PLACEHOLDER}`,
  go: `os.Getenv("${API_KEY_PLACEHOLDER}")`,
  java: `System.getenv("${API_KEY_PLACEHOLDER}")`,
  csharp: `Environment.GetEnvironmentVariable("${API_KEY_PLACEHOLDER}")`,
  ruby: `ENV["${API_KEY_PLACEHOLDER}"]`,
  curl: `$${API_KEY_PLACEHOLDER}`,
} as const;

/** ruby 双引号字符串里的 key 插值段（`"Bearer #{ENV['…']}"` 的 `#{…}` 部分）。 */
export const RUBY_KEY_INTERP = `#{ENV['${API_KEY_PLACEHOLDER}']}`;

/** codegen 里 base64 附件的截断占位符（图）。音/视频用 placeholderFor(modality)。 */
export const BASE64_PLACEHOLDER = '<YOUR_BASE64_IMAGE>';

/** 媒体占位 prompt（未输入时让代码示例可读） */
export const MEDIA_PLACEHOLDER = 'A serene mountain lake at sunset';
