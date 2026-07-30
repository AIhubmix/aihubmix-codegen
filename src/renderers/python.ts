/**
 * Python renderer：chat / messages / responses 走各自官方 SDK，gemini 走 google-genai。
 */
import type { CodeGenCtx } from '../types.js';
import { BASE } from '../config/placeholders.js';
import { esc } from '../emit/escape.js';
import { pyLiteral, sdkParamLines } from '../emit/literal.js';
import { buildBody } from '../wire/body.js';
import { geminiSdkCall } from './gemini-sdk.js';
import { imageNote, messagesLiteral } from './shared.js';

export function pyChat(ctx: CodeGenCtx): string {
  const { model, stream } = ctx;
  const params = sdkParamLines(buildBody('chat', ctx), 'python', 'chat', '    ');
  return `${imageNote(ctx, 'python', 'chat')}from openai import OpenAI

client = OpenAI(
    api_key="AIHUBMIX_API_KEY",
    base_url="${BASE}/v1",
)

response = client.chat.completions.create(
    model="${model.id}",
    messages=${messagesLiteral('chat', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${
  stream
    ? `\nfor chunk in response:\n    print(chunk.choices[0].delta.content or "", end="")`
    : `\nprint(response.choices[0].message.content)`
}`;
}

export function pyMessages(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const params = sdkParamLines(buildBody('messages', ctx), 'python', 'messages', '    ');
  // Anthropic：system 是独立字段（cache 时打 cache_control 断点）；messages 数组不含 system。
  const systemPy = sys
    ? ctx.cache
      ? `\n    system=${pyLiteral([{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], '    ')},`
      : `\n    system="${esc(sys)}",`
    : '';
  return `${imageNote(ctx, 'python', 'messages')}from anthropic import Anthropic

client = Anthropic(
    api_key="AIHUBMIX_API_KEY",
    base_url="${BASE}",
)

message = client.messages.create(
    model="${model.id}",${systemPy}
    messages=${messagesLiteral('messages', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${
  stream
    ? `\nwith message as stream:\n    for text in stream.text_stream:\n        print(text, end="")`
    : `\nprint(message.content[0].text)`
}`;
}

export function pyResponses(ctx: CodeGenCtx): string {
  const { model, sys, stream } = ctx;
  const params = sdkParamLines(buildBody('responses', ctx), 'python', 'responses', '    ');
  return `${imageNote(ctx, 'python', 'responses')}from openai import OpenAI

client = OpenAI(
    api_key="AIHUBMIX_API_KEY",
    base_url="${BASE}/v1",
)

response = client.responses.create(
    model="${model.id}",${sys ? `\n    instructions="${esc(sys)}",` : ''}
    input=${messagesLiteral('responses', ctx, 'python', '    ')},
${params}
    stream=${stream ? 'True' : 'False'},
)
${
  stream
    ? `\nfor event in response:\n    if event.type == "response.output_text.delta":\n        print(event.delta, end="")`
    : `\nprint(response.output_text)`
}`;
}

export function pyGemini(ctx: CodeGenCtx): string {
  const { contents, config } = geminiSdkCall(buildBody('gemini', ctx), true);
  const cfgLine = Object.keys(config).length ? `\n    config=${pyLiteral(config, '    ')},` : '';
  return `${imageNote(ctx, 'python', 'gemini')}from google import genai

client = genai.Client(
    api_key="AIHUBMIX_API_KEY",
    http_options={"base_url": "${BASE}/gemini"},
)

response = client.models.generate_content(
    model="${ctx.model.id}",
    contents=${pyLiteral(contents, '    ')},${cfgLine}
)
print(response.text)`;
}
