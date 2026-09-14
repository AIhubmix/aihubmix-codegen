/**
 * input_references 虚拟槽折叠 + filterParams 空容器裁剪。
 * 折叠规则是「真实请求 == Get Code」的共同前提：playground 运行时与本包生成的代码调用同一个函数。
 */
import { describe, it, expect } from 'vitest';
import { refImagesToWireFields } from '../src/wire/multimodal.js';
import { filterParams } from '../src/wire/media.js';
import type { ImagePart } from '../src/types.js';

const url = (src: string): ImagePart => ({ id: src, kind: 'url', src, mime: 'image/png', modality: 'image' });
const str = (p: ImagePart) => p.src;

describe('refImagesToWireFields — input_references 按类型拆槽', () => {
  it('三类槽折叠成一个数组，顺序 image → video → audio', () => {
    const out = refImagesToWireFields(
      {
        'input_references:audio_url': [url('https://x/a.mp3')],
        'input_references:video_url': [url('https://x/v.mp4')],
        'input_references:image_url': [url('https://x/i1.png'), url('https://x/i2.png')],
      },
      str,
    );
    expect(out.input_references).toEqual([
      { type: 'image_url', url: 'https://x/i1.png' },
      { type: 'image_url', url: 'https://x/i2.png' },
      { type: 'video_url', url: 'https://x/v.mp4' },
      { type: 'audio_url', url: 'https://x/a.mp3' },
    ]);
    expect(Object.keys(out)).toEqual(['input_references']);
  });

  it('单类型槽只出该类型的条目', () => {
    const out = refImagesToWireFields({ 'input_references:video_url': [url('https://x/v.mp4')] }, str);
    expect(out.input_references).toEqual([{ type: 'video_url', url: 'https://x/v.mp4' }]);
  });

  it('裸 input_references（老 schema 无 type enum）仍按 image_url 下发', () => {
    const out = refImagesToWireFields({ input_references: [url('https://x/i.png')] }, str);
    expect(out.input_references).toEqual([{ type: 'image_url', url: 'https://x/i.png' }]);
  });

  it('与 frame_images 虚拟槽、普通源图字段互不干扰', () => {
    const out = refImagesToWireFields(
      {
        'frame_images:last_frame': [url('https://x/last.png')],
        'frame_images:first_frame': [url('https://x/first.png')],
        'input_references:image_url': [url('https://x/ref.png')],
        image: [url('https://x/one.png')],
      },
      str,
    );
    expect(out.frame_images).toEqual([
      { frame_type: 'first_frame', image_url: { url: 'https://x/first.png' } },
      { frame_type: 'last_frame', image_url: { url: 'https://x/last.png' } },
    ]);
    expect(out.input_references).toEqual([{ type: 'image_url', url: 'https://x/ref.png' }]);
    expect(out.image).toBe('https://x/one.png');
  });

  it('空槽不产出 input_references 键', () => {
    expect(refImagesToWireFields({ 'input_references:image_url': [] }, str)).toEqual({});
  });
});

describe('filterParams — 空容器不下发', () => {
  it('丢掉 {} 与 []，保留有内容的复合值与 0/false', () => {
    expect(filterParams({ extra: {}, tags: [], keep: { a: 1 }, zero: 0, off: false })).toEqual({
      keep: { a: 1 },
      zero: 0,
      off: false,
    });
  });

  it('undefined / null / 空串仍然丢掉', () => {
    expect(filterParams({ a: undefined, b: null, c: '', d: 'x' })).toEqual({ d: 'x' });
  });
});
