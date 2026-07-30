/**
 * 占位文案与默认 base。
 *
 * BASE 是过渡态：下一步（ctx.baseUrl 必填）会把它从这里删掉，改由调用方注入 ——
 * inferera-web 是双域构建（aihubmix.com / inferera.com + api.inferera.com），
 * 写死在包里会让 inferera 域的详情页生成指向 aihubmix.com 的代码。
 */
export const BASE = 'https://aihubmix.com';

/** codegen 里 base64 附件的截断占位符（图）。音/视频用 placeholderFor(modality)。 */
export const BASE64_PLACEHOLDER = '<YOUR_BASE64_IMAGE>';

/** 媒体占位 prompt（未输入时让代码示例可读） */
export const MEDIA_PLACEHOLDER = 'A serene mountain lake at sunset';
