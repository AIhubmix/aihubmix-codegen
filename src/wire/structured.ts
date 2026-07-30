/**
 * 结构化输出的三协议 wire 形态（gemini 走 generationConfig.responseMimeType，不在此）。
 */
import type { StructuredCfg } from '../types.js';
import { parseSchemaSafe } from './schema.js';

export function chatResponseFormat(st: StructuredCfg): unknown {
  return st.format === 'json_object'
    ? { type: 'json_object' }
    : {
        type: 'json_schema',
        json_schema: {
          name: st.name || 'response',
          strict: true,
          schema: parseSchemaSafe(st.schema),
        },
      };
}

export function respTextFormat(st: StructuredCfg): unknown {
  return st.format === 'json_object'
    ? { type: 'json_object' }
    : {
        type: 'json_schema',
        name: st.name || 'response',
        strict: true,
        schema: parseSchemaSafe(st.schema),
      };
}

/** Anthropic Messages 结构化输出：output_config.format。
 *  形态 = { type:'json_schema', schema }（无 name/strict）；不支持 json_object → 返回 null 表示不下发。 */
export function msgOutputFormat(st: StructuredCfg): unknown | null {
  if (st.format === 'json_object') return null;
  return { type: 'json_schema', schema: parseSchemaSafe(st.schema) };
}
