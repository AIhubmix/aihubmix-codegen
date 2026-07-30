import type { LangDef } from '../types.js';

/**
 * 语言清单 —— 唯一真源。
 *
 * 暴露主流语言：脚本/SDK（Python·TypeScript·Ruby）+ 编译型（Go·Java·C#）+ 通用 REST(curl)。
 * 每个示例都被 scripts/verify-codegen.mjs 真实运行验证（缺运行时则 skip）；
 * verify 脚本必须 import 本文件，不许自己再抄一份清单 —— 否则新加的语言可能加了却没被真跑验证。
 *
 * 三组字段的用途分工：
 *   - `label`            → UI 语言菜单
 *   - `ext` / `fileName` → verify harness 写盘用（java 必须叫 Main.java，类名与文件名要一致）
 *   - `probe`            → 运行时探测。用「真跑一次版本命令」而非 `command -v` —— macOS 自带的
 *                          java stub 能骗过 command -v，探测通过但一编译就炸。
 *   - `comment`          → 单行注释符。能力注入层（capabilities/generate.ts）拿它把
 *                          silent-degrade 警告插进生成的代码里 —— 只在网页上提示留不住，
 *                          用户复制走的那段代码里必须带着。
 *   - `install`          → harness 一次装齐**全部协议**所需 SDK 的命令；与 `config/sdk.ts` 里
 *                          按 (lang × proto) 给用户看的那一行 install 是两回事，别合并。
 */
export const LANGS: LangDef[] = [
  {
    id: 'python',
    label: 'Python',
    ext: '.py',
    comment: '#',
    probe: { cmd: 'python3', args: ['--version'] },
    install: 'pip install openai anthropic',
  },
  {
    id: 'javascript',
    label: 'TypeScript',
    ext: '.mjs',
    comment: '//',
    probe: { cmd: 'node', args: ['--version'] },
    install: 'npm install openai @anthropic-ai/sdk',
  },
  {
    id: 'go',
    label: 'Go',
    ext: '.go',
    comment: '//',
    probe: { cmd: 'go', args: ['version'] },
    install: 'go get github.com/sashabaranov/go-openai',
  },
  {
    // java 单文件源码模式（JDK 11+ 的 `java Main.java`）要求文件名与 public class 名一致。
    id: 'java',
    label: 'Java',
    ext: '.java',
    fileName: 'Main.java',
    comment: '//',
    probe: { cmd: 'java', args: ['-version'] },
    install: null,
  },
  {
    // dotnet 跑的是项目不是文件：harness 另生成 app.csproj，Program.cs 是约定入口名。
    id: 'csharp',
    label: 'C#',
    ext: '.cs',
    fileName: 'Program.cs',
    comment: '//',
    probe: { cmd: 'dotnet', args: ['--version'] },
    install: null,
  },
  {
    // messages 走 net/http 零 gem；chat/responses 才需要 ruby-openai。
    id: 'ruby',
    label: 'Ruby',
    ext: '.rb',
    comment: '#',
    probe: { cmd: 'ruby', args: ['--version'] },
    install: 'gem install ruby-openai',
  },
  {
    id: 'curl',
    label: 'cURL',
    ext: '.sh',
    comment: '#',
    probe: { cmd: 'curl', args: ['--version'] },
    install: null,
  },
];

/** 按 id 取语言定义（未知 id 返回 undefined，调用方自行降级）。 */
export function langDef(id: string): LangDef | undefined {
  return LANGS.find((l) => l.id === id);
}
