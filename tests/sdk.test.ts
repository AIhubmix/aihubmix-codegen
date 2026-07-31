/**
 * config/sdk.ts 的自洽性 + 线上那个 bug 的回归。
 *
 * inferera-web `model.constant.js:308-325` 用 `Anthropic` 客户端建连，末行却读
 * `response.choices[0].message.content` —— Claude 系模型页的 python 示例照抄跑不通。
 * 把「用哪个客户端」和「怎么取响应」绑进 config/sdk.ts 同一条记录之后，这类错配结构上
 * 不可能再发生；下面两组断言负责把它钉死，防止有人重新拆开写。
 */
import { describe, expect, it } from 'vitest';
import { SDK } from '../src/config/sdk.js';
import { generateCode } from '../src/generate.js';
import { LANGS } from '../src/config/languages.js';
import { PROTOCOLS } from '../src/config/protocols.js';
import { baseCtx } from './fixture.js';

/** 客户端构造名 → 该客户端**不可能**出现的响应取值形状。 */
const CLIENT_SHAPE: { name: string; ctor: RegExp; mustNot: RegExp }[] = [
  // Anthropic Messages 的响应是 content[] 块数组，根本没有 choices —— 出现即错配。
  { name: 'Anthropic', ctor: /^(new )?Anthropic$/, mustNot: /choices\[/ },
  // OpenAI 系（chat/responses）没有 content[0].text 这种取法。
  { name: 'OpenAI', ctor: /^(new )?OpenAI$/, mustNot: /content\[0\]\.text/ },
  // Gemini 走 candidates[]，同样不该出现 choices。
  { name: 'GenAI', ctor: /GoogleGenAI|genai\.Client/, mustNot: /choices\[/ },
];

describe('config/sdk.ts 记录自洽', () => {
  it('Anthropic 客户端的 read 不得读 choices[]，反之不得读 content[0].text', () => {
    for (const [lang, byProto] of Object.entries(SDK)) {
      for (const [proto, def] of Object.entries(byProto ?? {})) {
        if (!def) continue;
        for (const shape of CLIENT_SHAPE) {
          if (!shape.ctor.test(def.clientCtor)) continue;
          const where = `${lang}/${proto} (${def.clientCtor})`;
          expect(shape.mustNot.test(def.read), `${where} read 读错了响应形状：${def.read}`).toBe(false);
          if (def.readStream) {
            expect(shape.mustNot.test(def.readStream), `${where} readStream 读错了响应形状`).toBe(false);
          }
        }
      }
    }
  });

  it('每条记录字段齐备（缺一项渲染出来就是半截代码）', () => {
    for (const [lang, byProto] of Object.entries(SDK)) {
      for (const [proto, def] of Object.entries(byProto ?? {})) {
        const where = `${lang}/${proto}`;
        expect(def, where).toBeTruthy();
        expect(def!.install.length, `${where} install`).toBeGreaterThan(0);
        expect(def!.imports.length, `${where} imports`).toBeGreaterThan(0);
        expect(def!.clientVar.length, `${where} clientVar`).toBeGreaterThan(0);
        expect(def!.clientCtor.length, `${where} clientCtor`).toBeGreaterThan(0);
        expect(def!.call.length, `${where} call`).toBeGreaterThan(0);
        expect(def!.resultVar.length, `${where} resultVar`).toBeGreaterThan(0);
        expect(def!.read.length, `${where} read`).toBeGreaterThan(0);
        // 流式两种形态互斥：尾部消费循环 vs 参数式回调（ruby-openai）
        expect(!(def!.readStream && def!.streamParam), `${where} readStream/streamParam 不能同时有`).toBe(true);
      }
    }
  });
});

describe('bug 回归：Claude 系 python 示例读错响应', () => {
  it('messages 协议的 python 示例读 content 里的 text 块，全文不得出现 choices[', () => {
    const code = generateCode('messages', 'python', baseCtx);
    expect(code).toContain('from anthropic import Anthropic');
    expect(code).toContain('message.content');
    expect(code).not.toContain('choices[');
  });

  // 第二个 bug，实测出来的：content[0] 在开思考的模型上是 thinking 块，
  // 粘进终端跑 claude-opus-5 五次挂三次（AttributeError: 'ThinkingBlock' has no attribute 'text'）。
  // 块数组一律按类型挑，所以任何 SDK 记录都不许再按下标取块里的正文。
  // 只盯**顶层**块数组：Anthropic 的 `content` 与 responses 的 `output`。
  // ruby responses 那条 `dig("output", -1, "content", 0, "text")` 不在此列 ——
  // 它先按 -1 选中了 message 块，里面那个 content 是该块的正文分片数组，不会混进 reasoning。
  it('顶层块数组不许按下标取正文（content[0] / output[0] 都不行）', () => {
    for (const [lang, byProto] of Object.entries(SDK)) {
      for (const [proto, def] of Object.entries(byProto ?? {})) {
        if (!def) continue;
        const where = `${lang}/${proto}`;
        expect(/\.content\[0\]|\.output\[0\]|dig\("output", 0/.test(def.read), `${where} read 按下标取块：${def.read}`).toBe(false);
      }
    }
  });

  it('messages 的 python / javascript 示例按 type == text 挑块', () => {
    expect(generateCode('messages', 'python', baseCtx)).toContain('b.type == "text"');
    expect(generateCode('messages', 'javascript', baseCtx)).toContain('b.type === "text"');
  });

  it('messages 协议的 javascript / ruby 示例同样不得出现 choices[', () => {
    for (const lang of ['javascript', 'ruby'] as const) {
      const code = generateCode('messages', lang, baseCtx);
      expect(code, `${lang}`).not.toContain('choices[');
    }
  });
});

describe('LANGS × PROTOCOLS 全矩阵', () => {
  it('28 个单元格都非空且不抛', () => {
    for (const proto of PROTOCOLS) {
      for (const lang of LANGS) {
        const where = `${proto.id}/${lang.id}`;
        let code = '';
        expect(() => { code = generateCode(proto.id, lang.id, baseCtx); }, where).not.toThrow();
        expect(code.trim().length, `${where} 产物为空`).toBeGreaterThan(0);
      }
    }
  });
});
