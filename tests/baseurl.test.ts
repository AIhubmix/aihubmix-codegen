/**
 * baseUrl 注入 —— 包里不再有 `const BASE = 'https://aihubmix.com'`。
 *
 * 两个动机：inferera-web 是双域构建（aihubmix.com / inferera.com + api.inferera.com），
 * 写死会让 inferera 域的详情页生成指向 aihubmix.com 的代码；verify 脚本原先靠
 * `code.replaceAll(...)` 后处理换域，意味着「被验证的字节 ≠ 用户拿到的字节」。
 */
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/config/languages.js';
import { PROTOCOLS } from '../src/config/protocols.js';
import { generateCode, generateDecisionCode, generateMediaCode } from '../src/generate.js';
import { ctxWith } from './fixture.js';

const INFERERA = 'https://api.inferera.com';

describe('ctx.baseUrl 贯穿全部产物', () => {
  it('28 个文本单元格：出现注入的 base，且一处 aihubmix.com 都没有', () => {
    const ctx = ctxWith({ baseUrl: INFERERA });
    for (const proto of PROTOCOLS) {
      for (const lang of LANGS) {
        const where = `${proto.id}/${lang.id}`;
        const code = generateCode(proto.id, lang.id, ctx);
        expect(code, `${where} 残留旧域`).not.toContain('aihubmix.com');
        expect(code, `${where} 没出现注入的 base`).toContain(INFERERA);
      }
    }
  });

  it('媒体单元格同样跟着 baseUrl 走', () => {
    for (const lang of LANGS) {
      for (const modality of ['image', 'video'] as const) {
        const code = generateMediaCode({
          baseUrl: INFERERA,
          modality,
          modelId: modality === 'image' ? 'gpt-image-2' : 'veo-3.5',
          prompt: 'a cat',
          params: {},
          lang: lang.id,
        });
        expect(code, `${modality}/${lang.id}`).not.toContain('aihubmix.com');
      }
    }
  });

  it('decision 单元格同样跟着 baseUrl 走', () => {
    for (const lang of LANGS) {
      const code = generateDecisionCode({ baseUrl: INFERERA, modelId: 'jev-1.13', lang: lang.id });
      expect(code, `decision/${lang.id}`).not.toContain('aihubmix.com');
      expect(code, `decision/${lang.id} 没出现注入的 base`).toContain(INFERERA);
    }
  });

  it('换 base 只换 base：其余字节逐字相同', () => {
    // 同一 ctx 只改 baseUrl，把新 base 换回旧 base 后必须与原产物完全一致 ——
    // 证明 baseUrl 没有顺带影响路由/鉴权/body 的任何其它判断。
    for (const proto of PROTOCOLS) {
      for (const lang of LANGS) {
        const a = generateCode(proto.id, lang.id, ctxWith({ baseUrl: 'https://aihubmix.com' }));
        const b = generateCode(proto.id, lang.id, ctxWith({ baseUrl: INFERERA }));
        expect(b.split(INFERERA).join('https://aihubmix.com'), `${proto.id}/${lang.id}`).toBe(a);
      }
    }
    for (const lang of LANGS) {
      const opts = { modelId: 'jev-1.13', lang: lang.id };
      const a = generateDecisionCode({ ...opts, baseUrl: 'https://aihubmix.com' });
      const b = generateDecisionCode({ ...opts, baseUrl: INFERERA });
      expect(b.split(INFERERA).join('https://aihubmix.com'), `decision/${lang.id}`).toBe(a);
    }
  });
});
