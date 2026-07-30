# @aihubmix/codegen

Pure, isomorphic request/code generator for the AIHubMix gateway — **4 protocols × 7 languages**.

The same `buildBody()` feeds both the generated snippet and the real request, so "what the panel shows" == "what gets sent" == "what the code example prints". No transport, no DOM, no network, no env reads.

```bash
pnpm add @aihubmix/codegen
```

Zero runtime dependencies. Ships ESM + CJS + `.d.ts` + `.d.cts`.

## Quick start

```ts
import { generateCode } from '@aihubmix/codegen';

const code = generateCode('messages', 'python', {
  baseUrl: 'https://aihubmix.com',   // required — see below
  model: { id: 'claude-opus-5' },
  sys: 'You are a helpful assistant.',
  user: 'Hello, how are you?',
  // `max_tokens` / `temperature` / `top_p` are required fields of `p`; `paramKeys`
  // decides which of them actually reach the wire.
  p: { max_tokens: 1024, temperature: 0.7, top_p: 0.9 },
  paramKeys: ['max_tokens'],
  stream: false,
});
```

## Support matrix

| `CodeLang` | label | `chat` | `messages` | `responses` | `gemini` |
|------------|-------|:------:|:----------:|:-----------:|:--------:|
| `python`     | Python     | SDK  | SDK  | SDK  | SDK  |
| `javascript` | TypeScript | SDK  | SDK  | SDK  | SDK  |
| `ruby`       | Ruby       | SDK  | SDK  | SDK  | SDK  |
| `go`         | Go         | SDK  | REST | REST | REST |
| `java`       | Java       | REST | REST | REST | REST |
| `csharp`     | C#         | REST | REST | REST | REST |
| `curl`       | cURL       | REST | REST | REST | REST |

Note the id is `javascript` even though the emitted code (and the display label) is TypeScript.

`SDK` = renders the vendor SDK (`openai`, `anthropic`, `google-genai`). `REST` = renders a raw HTTP call against the gateway. Both go through the same `buildBody()`.

Protocol → route and auth header are the gateway contract, and live in exactly one place (`src/config/protocols.ts`):

| protocol | route | auth header |
|---|---|---|
| `chat` | `/v1/chat/completions` | `Authorization: Bearer` |
| `responses` | `/v1/responses` | `Authorization: Bearer` |
| `messages` | `/v1/messages` | `x-api-key` (+ `anthropic-version`) |
| `gemini` | `/gemini/v1beta/models/{model}:generateContent` | `x-goog-api-key` |

Media generation (image / video × 7 languages) is available through `generateMediaCode(opts)`.

## `baseUrl` is required, and there is no setter

`CodeGenCtx.baseUrl` is a required field. This is deliberate:

- Consumers are **dual-domain builds** (`aihubmix.com` and `api.inferera.com`). A hard-coded base would make one domain emit code pointing at the other.
- Making it required means every call site fails to compile until it passes one explicitly.
- There is **no `setBaseUrl()`** or any module-level mutable state. Consumers plan to fork on the `Host` header at request time inside one process; module-level state would leak across concurrent requests.

## `paramKeys` is the only gate

`buildBody()` has three generic fall-through channels that claim new keys by type:

| value type | channel | behaviour |
|---|---|---|
| number | `emitExtraNumbers` | skips keys already handled specially |
| enum / string | `emitEnums` | sends only when non-empty and ≠ schema default |
| object / array / boolean | `emitObjects` | skips capability-gated keys and empty containers |

**All three are gated by `inSchema()`, i.e. `ctx.paramKeys`.** A key that the model's schema does not declare is never sent, even if a stale value for it is still sitting in `ctx`.

Consequence: **adding a parameter needs no change to this package.** Declare it in the schema, put a value in `ctx`, and all 28 cells pick it up.

Omitting `paramKeys` disables gating entirely (backwards compatibility). Prefer passing it.

Two lists still need manual upkeep, both covered by tests:

- `PY_OPENAI_NATIVE` — whether a key renders as a native kwarg or lands in `extra_body`. Fail-safe either way: the snippet still runs.
- `GO_CHAT_KEYS` / `GO_OBJ_FIELDS` — `go-openai`'s `ChatCompletionRequest` is a closed struct: no map fallback, no `ExtraBody` (checked against v1.41.2). So the `go` + `chat` cell is the one place where a body key can fail to reach the wire; the other six languages render whatever `buildBody()` produced.

  Every key that *does* have a struct field is mapped. Anything left over is **named in a comment in the emitted code** rather than silently dropped, so the snippet tells you what it isn't sending and points at `net/http` as the way out. `tests/extensibility.test.ts` asserts both halves — the leftover key appears in a comment and does *not* appear in the request struct — and `scripts/test-codegen-escaping.mjs` runs a real `go build` over the result. When you add a parameter, check whether `go-openai` has a field for it: if yes, map it and add the key here; if no, do nothing and the comment picks it up.

- `GO_REASONING_PREFIXES` — `go-openai` ships a **client-side** validator (`reasoning_validator.go`) that rejects a set of parameters for models whose id starts with `o1` / `o3` / `o4` / `gpt-5`. It fires *before the request is sent*, so a snippet that trips it prints a panic and never reaches the gateway. This is an SDK rule, not a gateway one — the identical body sent with `curl` returns 200.

  Consequently the `go` + `chat` cell renders `MaxCompletionTokens` instead of `MaxTokens` for those models, and omits `temperature`, `top_p`, `n`, the two penalties, and `logprobs` — again **naming them in a comment**, worded to distinguish "this SDK won't send it" from "no struct field exists". The trigger is the model id, not `paramKeys`: most models today carry no schema at all, and keying off one would put every `gpt-5` request on the panicking path. Mirror upstream when it changes; `tests/go-reasoning-validator.test.ts` covers both branches and the escaping harness `go build`s each.

## One wire-level correction

`buildBody()` passes values through; it does not second-guess them. The single exception is the `messages` protocol, where Anthropic requires `max_tokens` to be **strictly greater** than `thinking.budget_tokens` — violating it is a hard 400, not a degradation. When extended thinking is on and `max_tokens` is not above the budget, `buildBody()` raises it to `budget_tokens + 1024`.

It lives here rather than in a caller because the correction has to apply to the real request, not only to the printed snippet. A parameter panel that lets the user set an 8192 budget against a 1024 limit would otherwise show working code next to a request that 400s. `tests/thinking-budget.test.ts` calls `buildBody()` directly, without going through any capability layer, for exactly that reason.

## Node / CommonJS

The package must be `require()`-able from bare Node — `inferera-web`'s prerender step is a consumer:

```js
const { generateCode } = require('@aihubmix/codegen');
```

TypeScript projects on `moduleResolution: node16 | nodenext` resolve `./dist/index.d.cts` for `require` and `./dist/index.d.ts` for `import`.

## Scope: wire vocabulary only

This package speaks two things and nothing else: what the gateway's HTTP body looks like (four protocols — a closed set that only moves when an upstream API changes), and how to write that body as code in seven languages.

It deliberately does **not** speak knowledge-base vocabulary — capability keys (`reasoning-effort`, `vision`), verdicts (`tested-effective`, `silent-degrade`), or the knowledge base's own protocol identifiers. That vocabulary is an open set that grows on its own schedule; if it lived here, adding one capability upstream would mean a release of this package and an upgrade in every consumer. It lives in **`@aihubmix/model-schema`**, which depends on this package and translates knowledge-base records into the wire-only `CodeGenCtx` below. The dependency is one-way: nothing here imports that package.

`tests/vocabulary-isolation.test.ts` enforces this by scanning `src/` for those literals, so it is a build-time fact rather than a convention.

The package also ships **no UI**: no chips, no strikethrough styling, no syntax highlighting.

## Invariants

Enforced by tests in `tests/`, not by convention:

1. **Isomorphic** — no DOM, `window`, network, or env reads anywhere in `src/`.
2. **Single wire source** — every renderer's body comes from `buildBody()`; no bypass path.
3. **Facts live once** — auth headers, `anthropic-version`, the four routes, the API-key placeholder, SDK package names and response accessors appear only in `src/config/**`. `tests/fact-localization.test.ts` fails if one leaks into `src/renderers/**` or `scripts/**`.
4. **`CAP_GATED_WIRE_KEYS` is derived**, never hand-written twice.
5. **Wire vocabulary only** — no capability key, verdict, or knowledge-base protocol id appears in `src/`. `tests/vocabulary-isolation.test.ts` fails if one is added back.
6. **SDK records are self-consistent** — an `Anthropic` client's response accessor may not contain `choices[`, and an OpenAI client's may not contain `content[0].text`.

## Development

```bash
pnpm build          # tsup → ESM + CJS + d.ts + d.cts
pnpm test           # vitest
pnpm typecheck      # tsc --noEmit
pnpm test:all       # typecheck + vitest + classifier + escaping
pnpm smoke          # build, then require() from bare Node
pnpm verify:codegen # live verification — really runs the generated snippets
```

`verify:codegen` is the real acceptance criterion: it executes the generated code against a gateway and classifies the result. Pass the base URL in; never hard-code a domain or a key.

## License

MIT
