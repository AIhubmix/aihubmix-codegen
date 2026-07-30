/** 用户填写的 JSON Schema 字符串 → 对象；空/非法回退空 object schema。 */
export function parseSchemaSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { type: 'object' };
  }
}

/** 工具调用参数字符串 → 对象；非法回退 {}。 */
export function parseToolCallArgs(argsString: string): Record<string, unknown> {
  try {
    return JSON.parse(argsString);
  } catch {
    return {};
  }
}
