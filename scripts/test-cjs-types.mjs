/**
 * test-cjs-types.mjs —— CommonJS 消费者的**类型**能不能解析到（无网络 / 无 key）。
 *
 * 背景：scripts/smoke-node.cjs 已经验了「裸 node 能 require dist/index.cjs」，那是运行期。
 * 类型是另一条完全独立的路径：TypeScript 项目在 `moduleResolution: node16|nodenext` 下，
 * `require` 解析的是 CJS 声明（dist/index.d.cts）。这条断了运行期照样绿，只有消费端的
 * tsc 会报 TS7016「could not find a declaration file」——本仓 CI 一点声音都没有。
 *
 * 真正被这条测试钉住的是 **dist/index.d.cts 这个产物**（已负控验证：把它删掉，下面的 fixture
 * 立刻 TS7016）。tsup 的 `dts: true` 现在两份都产，哪天换打包器/改配置只产 .d.ts 就会被抓到。
 * package.json 里 `exports["."].require.types` 是把这条解析写明白，不靠「声明文件与 .cjs
 * 同名相邻」这个隐式回退。
 *
 * 做法：临时目录里造一个真的 CJS 工程（package.json type=commonjs + tsconfig nodenext +
 * 一个 .cts 源文件），用 node_modules 软链指向本包，跑本仓的 tsc：
 *   1. 编译必须零错误（证明类型解析得到、且签名可用）；
 *   2. --listFiles 的输出里必须出现 dist/index.d.cts（证明走的是 **.d.cts** 那条，
 *      不是 top-level "types" 的 index.d.ts —— 后者是 ESM 声明，混用会在消费端出现
 *      default import 之类的错配）。
 *
 * 用法：node scripts/test-cjs-types.mjs（dist 缺失时自动先构建）
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');

// 包名从 package.json 读,不抄一份字面量:改名了这条测试要跟着动,不能静默测一个不存在的包。
const NAME = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

const fail = (msg) => { console.log(`FAIL ${msg}`); process.exit(1); };

if (!existsSync(TSC)) fail(`找不到 ${TSC}，先跑 pnpm install`);

// 被测物是**构建产物**(dist/*.d.cts),不是 src/ —— 缺了就现构一份,别让这条测试静默 skip。
if (!existsSync(join(ROOT, 'dist', 'index.d.cts'))) {
  console.log('… dist/index.d.cts 不存在，先构建');
  await pexec('npx', ['tsup'], { cwd: ROOT });
}

const dir = await mkdtemp(join(tmpdir(), 'cg-cjs-'));
const [scope, bare] = NAME.startsWith('@') ? NAME.split('/') : [null, NAME];
const nm = join(dir, 'node_modules');
await mkdir(scope ? join(nm, scope) : nm, { recursive: true });
// 软链而不是复制:要测的正是 package.json exports 的解析,复制一份就可能测到过期副本。
await symlink(ROOT, join(nm, NAME), 'dir');

// type=commonjs + .cts 双保险:确保 tsc 按 CJS 解析这个文件,从而走 exports 的 require 条件。
await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'cjs-fixture', private: true, type: 'commonjs' }, null, 2));
await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    target: 'es2022',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  files: ['fixture.cts'],
}, null, 2));

// 真用一下签名:光 import 不调用的话,即使类型是 any 也能编过,测不出解析失败。
await writeFile(join(dir, 'fixture.cts'), `import cg = require('${NAME}');

const code: string = cg.generateCode('messages', 'python', {
  baseUrl: 'https://gateway.example',
  model: { id: 'claude-opus-5' },
  sys: 'You are a concise assistant.',
  user: 'Hello.',
  p: { max_tokens: 1024, temperature: 0.7, top_p: 0.9 },
  paramKeys: ['max_tokens'],
  stream: false,
});

const placeholder: string = cg.API_KEY_PLACEHOLDER;
console.log(code.length, placeholder);
`);

let out;
try {
  out = (await pexec(TSC, ['-p', 'tsconfig.json', '--listFiles'], { cwd: dir, maxBuffer: 32 * 1024 * 1024 })).stdout;
} catch (e) {
  console.log('FAIL CJS + nodenext 下编译不过：');
  console.log((e.stdout || e.message || '').toString().split('\n').slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('PASS CJS + nodenext 编译零错误');

if (!/index\.d\.cts$/m.test(out)) {
  console.log('FAIL 解析到的不是 dist/index.d.cts（说明 exports.require.types 没生效，回退到了 ESM 声明）');
  console.log(out.split('\n').filter((l) => /aihubmix-codegen|index\.d\./.test(l)).join('\n'));
  process.exit(1);
}
console.log('PASS require 条件解析到 dist/index.d.cts');
console.log('\n结果：全部通过');
