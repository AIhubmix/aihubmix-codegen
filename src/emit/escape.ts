/**
 * 与协议无关的语言级转义工具。这些是语言语法常量，不进 config。
 */

export function esc(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/** 安全嵌入 shell 单引号 -d '...'：把单引号换成 '\'' （否则 prompt 含 ' 会截断命令） */
export function shellSafe(body: string): string {
  return body.replace(/'/g, `'\\''`);
}

/** 安全嵌入 Go raw string `...`：把反引号拼接出来（否则 prompt 含 ` 会截断 raw string） */
export function goRawSafe(body: string): string {
  return body.replace(/`/g, '`+"`"+`');
}

/** 安全嵌入 Java 文本块 """...""":文本块最后一步会**解释转义序列**(\"→"、\\→\),
 *  与 C# 原始字符串(逐字不解转义)不同。把 JSON 里的反斜杠翻倍,Java 解转义后正好还原出合法 JSON;
 *  否则内容含 " 或 \ 时(JSON 会写成 \" / \\)被二次解转义→ JSON 语法破坏。indent 与闭合 """ 同列(8 空格)。 */
export function javaTextBlockSafe(jsonStr: string): string {
  return jsonStr
    .replace(/\\/g, '\\\\')
    .split('\n')
    .map((l) => '        ' + l)
    .join('\n');
}

export function num(n: number): string {
  return Number.isInteger(n) ? '' + n : (+n).toString();
}

/** Ruby 双引号字符串字面量:在 JSON 双引号转义基础上再转义 `#`——Ruby 双引号会插值 #{expr}/#@ivar/#$gvar,
 *  内容含 `#{...}` 时不转义会:轻则运行报错(假红),重则 `#{system("id")}` 在用户机上执行(代码注入)。
 *  `\#` 在 Ruby 双引号里就是字面 `#`。返回带引号的完整字面量。 */
export function rubyStr(s: string): string {
  return JSON.stringify(String(s)).replace(/#/g, '\\#');
}

/** rubyStr 的「已带引号位置」变体:供模板里已写 "..." 的插值点(如 "${rubyEsc(sys)}")用,不含外层引号。 */
export function rubyEsc(s: string): string {
  return esc(s).replace(/#/g, '\\#');
}
