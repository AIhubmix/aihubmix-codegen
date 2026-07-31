/**
 * (语言 × 协议) → SDK 事实表：装哪个包、import 什么、用哪个客户端、调哪个方法、怎么取响应。
 *
 * 为什么单列一张表：「用哪个客户端」和「怎么取响应」必须绑在同一条记录里。
 * 线上 inferera-web `model.constant.js:308-325` 正是把两者拆开写才出的 bug ——
 * 用 `Anthropic` 客户端建连，末行却读 `response.choices[0].message.content`（应为
 * `response.content[0].text`），Claude 系模型页的 python 示例照抄跑不通。绑成一条之后
 * 这类错配是结构上不可能，且可被一条自洽性测试钉死。
 *
 * `read` 还有第二类坑：**取对了客户端也可能取错块**。Anthropic 的 `content` 与 OpenAI
 * responses 的 `output` 都是块数组，开思考的模型会把 `thinking` / `reasoning` 排在第一块，
 * 按下标 `[0]` 取正文时灵时不灵（claude-opus-5 实测五次挂三次）。所以块数组一律**按类型挑**，
 * 不按下标取 —— ruby responses 那条注释是同一个教训的更早一版。
 *
 * 只覆盖 SDK 型单元格；原生 REST 单元格（go/java/csharp/curl 的非 chat 协议）不需要。
 * 纯数据、零逻辑、可 JSON 序列化 —— 将来若改由 canon 生成，是换数据源不是重写结构。
 */
import type { CodeLang, CodeProto } from '../types.js';

export interface SdkDef {
  /** 安装命令（供 UI 或文档展示，非代码骨架的一部分）。 */
  install: string;
  /** import / require 行，逐行原样出（缩进由 renderer 加）。 */
  imports: string[];
  /** 客户端变量名 —— 多数语言是 `client`，js gemini 是 `ai`。 */
  clientVar: string;
  /** 客户端构造表达式（不含参数）。与 `read` 同处一条记录是本表的存在理由。 */
  clientCtor: string;
  /** 接在 baseUrl 后的路径后缀：OpenAI 系要 `/v1`，Anthropic 直连网关根，gemini 走 `/gemini`。 */
  baseSuffix: string;
  /** 调用表达式（不含参数）。 */
  call: string;
  /** 承接返回值的变量名 —— Anthropic 系惯例叫 `message`，其余 `response`。 */
  resultVar: string;
  /** 非流式取值代码（不含前导换行）。 */
  read: string;
  /** 流式取值代码（写在调用之后）。与 streamParam 互斥。 */
  readStream?: string;
  /** 流式以「参数」形态传入（ruby-openai 的 `stream: proc {...}`），不是尾部消费循环。 */
  streamParam?: string;
}

export const SDK: Partial<Record<CodeLang, Partial<Record<CodeProto, SdkDef>>>> = {
  python: {
    chat: {
      install: 'pip install openai',
      imports: ['from openai import OpenAI'],
      clientVar: 'client',
      clientCtor: 'OpenAI',
      baseSuffix: '/v1',
      call: 'client.chat.completions.create',
      resultVar: 'response',
      read: 'print(response.choices[0].message.content)',
      readStream: 'for chunk in response:\n    print(chunk.choices[0].delta.content or "", end="")',
    },
    messages: {
      install: 'pip install anthropic',
      imports: ['from anthropic import Anthropic'],
      clientVar: 'client',
      clientCtor: 'Anthropic',
      baseSuffix: '',
      call: 'client.messages.create',
      resultVar: 'message',
      // 不能写 content[0]：Claude 系默认开思考，content 里第一块常常是 thinking，
      // 取 [0].text 会 AttributeError（实测 claude-opus-5 五次里挂三次）。
      read: '# content may start with a thinking block — pick by type, not by index\nprint(next(b.text for b in message.content if b.type == "text"))',
      readStream: 'with message as stream:\n    for text in stream.text_stream:\n        print(text, end="")',
    },
    responses: {
      install: 'pip install openai',
      imports: ['from openai import OpenAI'],
      clientVar: 'client',
      clientCtor: 'OpenAI',
      baseSuffix: '/v1',
      call: 'client.responses.create',
      resultVar: 'response',
      read: 'print(response.output_text)',
      readStream:
        'for event in response:\n    if event.type == "response.output_text.delta":\n        print(event.delta, end="")',
    },
    gemini: {
      install: 'pip install google-genai',
      imports: ['from google import genai'],
      clientVar: 'client',
      clientCtor: 'genai.Client',
      baseSuffix: '/gemini',
      call: 'client.models.generate_content',
      resultVar: 'response',
      read: 'print(response.text)',
    },
  },
  javascript: {
    chat: {
      install: 'npm i openai',
      imports: ['import OpenAI from "openai";'],
      clientVar: 'client',
      clientCtor: 'new OpenAI',
      baseSuffix: '/v1',
      call: 'client.chat.completions.create',
      resultVar: 'response',
      read: 'console.log(response.choices[0].message.content);',
      readStream:
        'for await (const chunk of response) {\n  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");\n}',
    },
    messages: {
      install: 'npm i @anthropic-ai/sdk',
      imports: ['import Anthropic from "@anthropic-ai/sdk";'],
      clientVar: 'client',
      clientCtor: 'new Anthropic',
      baseSuffix: '',
      call: 'client.messages.create',
      resultVar: 'message',
      // 同 python：content[0] 可能是 thinking 块，见下方 python messages 的注释。
      read: '// content may start with a thinking block — pick by type, not by index\nconsole.log(message.content.find((b) => b.type === "text")?.text);',
      readStream:
        'for await (const event of message) {\n  if (event.type === "content_block_delta") process.stdout.write(event.delta.text ?? "");\n}',
    },
    responses: {
      install: 'npm i openai',
      imports: ['import OpenAI from "openai";'],
      clientVar: 'client',
      clientCtor: 'new OpenAI',
      baseSuffix: '/v1',
      call: 'client.responses.create',
      resultVar: 'response',
      read: 'console.log(response.output_text);',
      readStream:
        'for await (const event of response) {\n  if (event.type === "response.output_text.delta") process.stdout.write(event.delta);\n}',
    },
    gemini: {
      install: 'npm i @google/genai',
      imports: ['import { GoogleGenAI } from "@google/genai";'],
      clientVar: 'ai',
      clientCtor: 'new GoogleGenAI',
      baseSuffix: '/gemini',
      call: 'ai.models.generateContent',
      resultVar: 'response',
      read: 'console.log(response.text);',
    },
  },
  ruby: {
    // messages / gemini 无可用 gem（ruby-anthropic 不支持自定义 base URL、gemini 无官方 SDK），
    // 走原生 net/http，故本表只有两条。
    chat: {
      install: 'gem install ruby-openai',
      imports: ['require "openai"'],
      clientVar: 'client',
      clientCtor: 'OpenAI::Client.new',
      baseSuffix: '',
      call: 'client.chat',
      resultVar: 'response',
      read: 'puts response.dig("choices", 0, "message", "content")',
      streamParam: 'stream: proc { |chunk, _event| print chunk.dig("choices", 0, "delta", "content") },',
    },
    responses: {
      install: 'gem install ruby-openai',
      imports: ['require "openai"'],
      clientVar: 'client',
      clientCtor: 'OpenAI::Client.new',
      baseSuffix: '',
      call: 'client.responses.create',
      resultVar: 'response',
      read: '# output[0] may be reasoning — the reply text is usually in the last output block\nputs response.dig("output", -1, "content", 0, "text")',
      streamParam: 'stream: proc { |chunk, _event| print chunk.dig("delta") },',
    },
  },
  go: {
    // go-openai 只覆盖 chat；其余协议走 net/http 原生 REST。
    chat: {
      install: 'go get github.com/sashabaranov/go-openai',
      imports: ['openai "github.com/sashabaranov/go-openai"'],
      clientVar: 'client',
      clientCtor: 'openai.DefaultConfig',
      baseSuffix: '/v1',
      call: 'client.CreateChatCompletion',
      resultVar: 'resp',
      read: 'fmt.Println(resp.Choices[0].Message.Content)',
    },
  },
};

/** 取一条 SDK 记录；无记录表示该 (语言 × 协议) 走原生 REST。 */
export function sdkDef(lang: CodeLang, proto: CodeProto): SdkDef | undefined {
  return SDK[lang]?.[proto];
}
