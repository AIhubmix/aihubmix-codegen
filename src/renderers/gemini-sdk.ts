/**
 * Gemini 官方 SDK（google-genai / @google/genai）调用面：wire body → { contents, config }。
 * python 与 typescript renderer 共用（仅键命名风格不同）。
 */
function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, (m) => '_' + m.toLowerCase());
}

/** 把 wire body 拆成 SDK 调用的 { contents, config }。config 键按语言：python=snake_case / js=camelCase。
 *  只重命名已知 SDK 字段，**绝不深转 tool.parameters 里的用户自定义 schema 键**。 */
export function geminiSdkCall(
  body: Record<string, unknown>,
  snake: boolean,
): { contents: unknown; config: Record<string, unknown> } {
  const config: Record<string, unknown> = {};
  const gc = (body.generationConfig ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(gc)) config[snake ? camelToSnake(k) : k] = v;
  if (body.systemInstruction) config[snake ? 'system_instruction' : 'systemInstruction'] = body.systemInstruction;
  if (Array.isArray(body.tools)) {
    // 只把 wrapper 键 functionDeclarations→function_declarations（python）；里面的 name/description/parameters 原样保留。
    config.tools = snake
      ? (body.tools as Record<string, unknown>[]).map((t) => {
          if (!('functionDeclarations' in t)) return t;
          const { functionDeclarations, ...rest } = t;
          return { function_declarations: functionDeclarations, ...rest };
        })
      : body.tools;
  }
  if (body.toolConfig) {
    if (snake) {
      const fcc = (body.toolConfig as Record<string, unknown>).functionCallingConfig as Record<string, unknown> | undefined;
      const inner: Record<string, unknown> = { mode: fcc?.mode };
      if (fcc?.allowedFunctionNames) inner.allowed_function_names = fcc.allowedFunctionNames;
      config.tool_config = { function_calling_config: inner };
    } else {
      config.toolConfig = body.toolConfig;
    }
  }
  return { contents: body.contents, config };
}
