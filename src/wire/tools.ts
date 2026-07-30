/**
 * tools / tool_choice 的四协议 wire 形态。
 */
import type { CodeGenCtx, CodeProto, ToolDef } from '../types.js';
import { parseSchemaSafe } from './schema.js';

/** 工具参数 JSON Schema：解析用户填写的字符串；空/非法回退空 object schema。 */
function toolParams(t: ToolDef): Record<string, unknown> {
  if (t.parameters && t.parameters.trim()) {
    const parsed = parseSchemaSafe(t.parameters);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
}

export function chatToolsArr(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: toolParams(t),
    },
  }));
}

export function msgToolsArr(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: toolParams(t),
  }));
}

export function respToolsArr(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description || '',
    parameters: toolParams(t),
  }));
}

/** Gemini 原生工具：单个 { functionDeclarations:[{name,description,parameters}] }。 */
export function geminiToolsArr(tools: ToolDef[]): unknown[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        parameters: toolParams(t),
      })),
    },
  ];
}

/** tool_choice wire 值（仅 tools 启用时调用）：auto → 不发(undefined)；按协议映射 OpenAI vs Anthropic 形态。 */
export function toolChoiceWire(proto: CodeProto, tc?: CodeGenCtx['toolChoice']): unknown {
  if (!tc || tc.mode === 'auto') return undefined; // auto = vendor 默认，省略
  if (proto === 'messages') {
    // Anthropic：none/any/tool（无「required」字面，用 any）
    if (tc.mode === 'none') return { type: 'none' };
    if (tc.mode === 'required') return { type: 'any' };
    if (tc.mode === 'tool') return tc.name ? { type: 'tool', name: tc.name } : undefined;
    return undefined;
  }
  if (proto === 'gemini') {
    // Gemini：toolConfig.functionCallingConfig.mode = AUTO|ANY|NONE；指定工具用 allowedFunctionNames。
    if (tc.mode === 'none') return { functionCallingConfig: { mode: 'NONE' } };
    if (tc.mode === 'required') return { functionCallingConfig: { mode: 'ANY' } };
    if (tc.mode === 'tool')
      return tc.name
        ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tc.name] } }
        : undefined;
    return undefined;
  }
  // OpenAI chat/responses
  if (tc.mode === 'none') return 'none';
  if (tc.mode === 'required') return 'required';
  if (tc.mode === 'tool') return tc.name ? { type: 'function', function: { name: tc.name } } : undefined;
  return undefined;
}
