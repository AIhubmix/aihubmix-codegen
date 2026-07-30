/**
 * 参数门控小工具。单独成文件是为了让 body.ts 与 capabilities.ts 都能用而不成环。
 */
import type { CodeGenCtx } from '../types.js';

/** 该参数键是否应下发：未提供 paramKeys 则不门控（向后兼容）；提供则只发 schema 声明的键。 */
export function inSchema(ctx: CodeGenCtx, key: string): boolean {
  return !ctx.paramKeys || ctx.paramKeys.includes(key);
}

/** 是否为空容器（空对象 {} 或空数组 []）——视为未设置，不下发。 */
export function isEmptyContainer(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (v !== null && typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}
