/**
 * TypeScript / JavaScript renderer：chat / messages / responses 走各自官方 SDK，gemini 走 @google/genai。
 */
import type { CodeGenCtx } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { esc } from '../emit/escape.js';
import { jsLiteral, sdkParamLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { geminiSdkCall } from './gemini-sdk.js';
import { imageNote, messagesLiteral } from './shared.js';

export function tsChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const params = sdkParamLines(buildBody('chat', ctx), 'js', 'chat', '  ');
  return `${imageNote(ctx, 'js', 'chat')}import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.AIHUBMIX_API_KEY,
  baseURL: "${BASE}/v1",
});

const response = await client.chat.completions.create({
  model: "${model.id}",
  messages: ${messagesLiteral('chat', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${
  stream
    ? `\nfor await (const chunk of response) {\n  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");\n}`
    : `\nconsole.log(response.choices[0].message.content);`
}`;
}

export function tsMessages(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const params = sdkParamLines(buildBody('messages', ctx), 'js', 'messages', '  ');
  // Anthropic：system 是独立字段（cache 时打 cache_control 断点）；messages 数组不含 system。
  const systemTs = sys
    ? ctx.cache
      ? `\n  system: ${jsLiteral([{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], '  ')},`
      : `\n  system: "${esc(sys)}",`
    : '';
  return `${imageNote(ctx, 'js', 'messages')}import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.AIHUBMIX_API_KEY,
  baseURL: "${BASE}",
});

const message = await client.messages.create({
  model: "${model.id}",${systemTs}
  messages: ${messagesLiteral('messages', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${
  stream
    ? `\nfor await (const event of message) {\n  if (event.type === "content_block_delta") process.stdout.write(event.delta.text ?? "");\n}`
    : `\nconsole.log(message.content[0].text);`
}`;
}

export function tsResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const params = sdkParamLines(buildBody('responses', ctx), 'js', 'responses', '  ');
  return `${imageNote(ctx, 'js', 'responses')}import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.AIHUBMIX_API_KEY,
  baseURL: "${BASE}/v1",
});

const response = await client.responses.create({
  model: "${model.id}",${sys ? `\n  instructions: "${esc(sys)}",` : ''}
  input: ${messagesLiteral('responses', ctx, 'js', '  ')},
${params}
  stream: ${stream},
});
${
  stream
    ? `\nfor await (const event of response) {\n  if (event.type === "response.output_text.delta") process.stdout.write(event.delta);\n}`
    : `\nconsole.log(response.output_text);`
}`;
}

export function tsGemini(ctx: CodeGenCtx): string {
  const { contents, config } = geminiSdkCall(buildBody('gemini', ctx), false);
  const cfgLine = Object.keys(config).length ? `\n  config: ${jsLiteral(config, '  ')},` : '';
  return `${imageNote(ctx, 'js', 'gemini')}import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "AIHUBMIX_API_KEY",
  httpOptions: { baseUrl: "${BASE}/gemini" },
});

const response = await ai.models.generateContent({
  model: "${ctx.model.id}",
  contents: ${jsLiteral(contents, '  ')},${cfgLine}
});
console.log(response.text);`;
}
