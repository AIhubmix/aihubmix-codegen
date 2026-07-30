/**
 * node 冒烟：证明构建产物能在**没有打包器、没有 DOM**的裸 node 里直接跑。
 *
 * 为什么单独一条而不是并进 vitest：vitest 跑的是 src/ 的 TS 源码，验不到 dist 的
 * CJS 互操作（`require()` 一个 ESM-first 的包最容易在这里炸）。而 inferera-web 的
 * prerender-models.js 是 CommonJS 脚本，构建期直出模型页正文时会 require 本包 ——
 * 那条路径坏了，前端 CI 不会红，是上线才发现的那种。
 *
 * 用法：pnpm build && node scripts/smoke-node.cjs
 */
const assert = require('node:assert');
const { join } = require('node:path');

const DIST = join(__dirname, '..', 'dist');
const g = require(join(DIST, 'index.cjs'));

// 用 inferera 域，顺带验 baseUrl 注入在构建产物里也生效（不是只在源码里）。
const BASE = 'https://api.inferera.com';
const ctx = {
  baseUrl: BASE,
  model: { id: 'claude-opus-5' },
  sys: 'You are a concise assistant.',
  user: 'Summarize the differences between the four protocols.',
  p: { max_tokens: 1024, temperature: 0.7, top_p: 0.9 },
  stream: false,
  paramKeys: ['max_tokens', 'temperature', 'top_p'],
};

let cells = 0;
for (const proto of g.PROTOCOLS) {
  for (const lang of g.LANGS) {
    const where = `${proto.id}/${lang.id}`;
    const code = g.generateCode(proto.id, lang.id, ctx);
    assert.ok(code && code.length > 50, `${where} 产物为空`);
    assert.ok(code.includes(BASE), `${where} 没用注入的 baseUrl`);
    assert.ok(!code.includes('aihubmix.com'), `${where} 残留写死的域名`);
    cells++;
  }
}
assert.strictEqual(cells, 28, `单元格数应为 4 协议 × 7 语言 = 28，实得 ${cells}`);

// 线上 model.constant.js:308-325 那个 bug 的回归：Anthropic 客户端不得读 choices[]
const py = g.generateCode('messages', 'python', ctx);
assert.ok(py.includes('message.content'), 'messages/python 取值行不对');
// content[0] 在开思考的模型上是 thinking 块，必须按类型挑
assert.ok(!py.includes('content[0]'), 'messages/python 又按下标取块了');
assert.ok(!py.includes('choices['), 'messages/python 混进了 OpenAI 的取值写法');

assert.deepStrictEqual(g.protosFromEndpoints('chat_completions,claude_api,responses'), [
  'chat',
  'messages',
  'responses',
]);

console.log(`node 冒烟通过：require CJS OK，${cells} 个单元格全部非空且用的是注入的 baseUrl`);
