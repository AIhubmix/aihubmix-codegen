/**
 * 各语言的字面量渲染 + SDK 参数行。与协议无关，属语言语法层。
 */
import type { CodeProto } from '../types.js';
import { PY_OPENAI_NATIVE, STRUCT_KEYS } from '../config/wire-policy.js';
import { num, rubyStr } from './escape.js';

export function jsonLines(obj: unknown, indent: string): string {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((l) => indent + l)
    .join('\n');
}

export function blockLines(obj: unknown, pad: string): string {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map((l, i) => (i === 0 ? l : pad + l))
    .join('\n');
}

export function pyLiteral(obj: unknown, pad: string): string {
  // 递归渲染(与 jsLiteral 同构),只把**真正的** boolean/null 值转 True/False/None——
  // 旧版在整段 JSON 文本上正则替换 \btrue|false|null\b,会误改字符串值里的这些单词
  // (如 system "Return true when valid" → "Return True when valid",语义被篡改)。
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    const inner = obj.map((v) => pad + '  ' + pyLiteral(v, pad + '  ')).join(',\n');
    return `[\n${inner}\n${pad}]`;
  }
  if (obj !== null && typeof obj === 'object') {
    const ents = Object.entries(obj as Record<string, unknown>);
    if (!ents.length) return '{}';
    const inner = ents
      .map(([k, v]) => `${pad}  ${JSON.stringify(k)}: ${pyLiteral(v, pad + '  ')}`)
      .join(',\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof obj === 'string') return JSON.stringify(obj); // Python 接受 JSON 双引号字符串;不插值,# 安全
  if (typeof obj === 'number') return num(obj);
  if (typeof obj === 'boolean') return obj ? 'True' : 'False';
  return 'None';
}

/** JS/TS 对象字面量多行渲染：标识符键不加引号，2 空格逐层缩进（贴合 SDK 模板风格）。 */
export function jsLiteral(obj: unknown, pad: string): string {
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    const inner = obj.map((v) => pad + '  ' + jsLiteral(v, pad + '  ')).join(',\n');
    return `[\n${inner}\n${pad}]`;
  }
  if (obj !== null && typeof obj === 'object') {
    const ents = Object.entries(obj as Record<string, unknown>);
    if (!ents.length) return '{}';
    const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
    const inner = ents
      .map(([k, v]) => `${pad}  ${key(k)}: ${jsLiteral(v, pad + '  ')}`)
      .join(',\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number') return num(obj);
  if (typeof obj === 'boolean') return String(obj);
  return 'null';
}

/** Ruby 字面量：对象→{ "k" => v }，数组→[ v ]，bool/nil 按 ruby 语法。 */
export function rbLiteral(obj: unknown, pad: string): string {
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    const inner = obj.map((v) => pad + '  ' + rbLiteral(v, pad + '  ')).join(',\n');
    return `[\n${inner}\n${pad}]`;
  }
  if (obj !== null && typeof obj === 'object') {
    const ents = Object.entries(obj as Record<string, unknown>);
    if (!ents.length) return '{}';
    const inner = ents
      .map(([k, v]) => `${pad}  ${rubyStr(k)} => ${rbLiteral(v, pad + '  ')}`)
      .join(',\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof obj === 'string') return rubyStr(obj); // Ruby 双引号:转义 # 防 #{} 插值
  if (typeof obj === 'number') return num(obj);
  if (typeof obj === 'boolean') return String(obj);
  return 'nil';
}

function fmtVal(v: unknown, lang: 'python' | 'js', pad: string): string {
  if (v !== null && typeof v === 'object') return lang === 'python' ? pyLiteral(v, pad) : blockLines(v, pad);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return num(v);
  if (typeof v === 'boolean') return lang === 'python' ? (v ? 'True' : 'False') : String(v);
  return JSON.stringify(v);
}

/** 把 buildBody 产出的非结构性键渲染成 SDK 参数行（每行含尾逗号，pad 缩进）。 */
export function sdkParamLines(
  body: Record<string, unknown>,
  lang: 'python' | 'js',
  proto: CodeProto,
  pad: string,
): string {
  const openaiFamily = proto !== 'messages';
  const lines: string[] = [];
  const extra: string[] = []; // 仅 python OpenAI：非原生键
  const sep = lang === 'python' ? '=' : ': ';
  for (const [k, v] of Object.entries(body)) {
    if (STRUCT_KEYS.has(k)) continue;
    if (lang === 'python' && openaiFamily && !PY_OPENAI_NATIVE.has(k)) {
      extra.push(`${pad}    "${k}": ${fmtVal(v, 'python', pad + '    ')},`);
    } else {
      lines.push(`${pad}${k}${sep}${fmtVal(v, lang, pad)},`);
    }
  }
  if (extra.length) {
    lines.push(lang === 'python'
      ? `${pad}extra_body={\n${extra.join('\n')}\n${pad}},`
      : extra.join('\n'));
  }
  return lines.join('\n');
}

/** buildBody 非结构性键 → ruby-openai `parameters:` 行（符号键 key:），值用 rbLiteral。 */
export function rubyParamLines(body: Record<string, unknown>, pad: string): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (STRUCT_KEYS.has(k)) continue;
    lines.push(`${pad}${k}: ${rbLiteral(v, pad)},`);
  }
  return lines.join('\n');
}
