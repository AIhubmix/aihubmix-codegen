/**
 * 产物语言红线：**生成出来的代码里不许出现中文**。
 *
 * 包的源码注释是中文（仓库惯例，不改）；但 `generateCode` / `generateMediaCode` 吐出去的
 * 那段字符串是**给用户看的产物** —— 它会出现在 aihubmix.com / api.inferera.com 的模型详情页
 * （站点 18 个语言包）和 playground 的 Get Code 面板里。中文注释对英文用户是噪音，
 * 复制进代码库还会带出编码问题。
 *
 * 这条以前没人钉，结果 messages 的取值行、ruby 的 base URL 说明、媒体 4 门语言的
 * Step 注释和 println 文案一路带着中文发到了线上详情页。
 *
 * 判据是「CJK 统一表意文字 + 中文标点」，不是「非 ASCII」—— 产物里的 `—`、`≥` 之类
 * 排版符号是可以的，真正的问题是中文。
 *
 * 注意：这里所有输入（sys/user/prompt/模型名）都是纯 ASCII，所以命中的中文只可能来自模板。
 * 用户自己输入中文 prompt 当然照常进产物，那是数据不是模板，不受这条约束。
 */
import { describe, it, expect } from 'vitest';
import {
  generateCode,
  generateDecisionCode,
  generateMediaCode,
  PROTOCOLS,
  LANGS,
} from '../src/index.js';
import { BASE, baseCtx, ctxWith, TOOLS, STRUCTURED } from './fixture.js';

/** CJK 统一表意文字 + 中文标点（，。：；（）「」【】等）。 */
const CJK = /[一-鿿　-〿＀-￯]/;

function cjkLines(code: string): string[] {
  return code.split('\n').filter((l) => CJK.test(l));
}

describe('生成的代码里没有中文', () => {
  for (const proto of PROTOCOLS) {
    for (const lang of LANGS) {
      it(`${proto.id} / ${lang.id}`, () => {
        // 基础形态 + 满参数 + 流式 + 工具 + 结构化输出，覆盖模板里所有条件分支
        const variants = [
          ctxWith({ paramKeys: [], stream: false }),
          baseCtx,
          ctxWith({ stream: true }),
          ctxWith({ tools: TOOLS }),
          ctxWith({ structured: STRUCTURED }),
        ];
        for (const ctx of variants) {
          expect(cjkLines(generateCode(proto.id, lang.id, ctx))).toEqual([]);
        }
      });
    }
  }
});

describe('生成的媒体代码里没有中文', () => {
  for (const modality of ['image', 'video'] as const) {
    for (const lang of LANGS) {
      it(`${modality} / ${lang.id}`, () => {
        const code = generateMediaCode({
          baseUrl: BASE,
          modality,
          modelId: 'sora-2',
          prompt: 'a cat riding a bicycle',
          params: { seconds: 8 },
          lang: lang.id,
        });
        expect(cjkLines(code)).toEqual([]);
      });
    }
  }
});

describe('生成的 decision 代码里没有中文', () => {
  for (const lang of LANGS) {
    it(`decision / ${lang.id}`, () => {
      // 缺省（走占位模板）与自带输入两种形态，覆盖 body 的两条来源。
      const variants = [
        { baseUrl: BASE, modelId: 'jev-1.13', lang: lang.id },
        {
          baseUrl: BASE,
          modelId: 'jev-1.13',
          state: 'a support ticket',
          questions: { ok: { type: 'noul' as const, instructions: 'Is this resolved?' } },
          lang: lang.id,
        },
      ];
      for (const opts of variants) {
        expect(cjkLines(generateDecisionCode(opts))).toEqual([]);
      }
    });
  }
});
