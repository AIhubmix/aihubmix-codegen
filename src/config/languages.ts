import type { LangDef } from '../types.js';

/**
 * 语言清单 —— 唯一真源。
 *
 * 暴露主流语言：脚本/SDK（Python·TypeScript·Ruby）+ 编译型（Go·Java·C#）+ 通用 REST(curl)。
 * 每个示例都被 scripts/verify-codegen.mjs 真实运行验证（缺运行时则 skip）；
 * verify 脚本必须 import 本文件，不许自己再抄一份清单 —— 否则新加的语言可能加了却没被真跑验证。
 */
export const LANGS: LangDef[] = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'curl', label: 'cURL' },
];
