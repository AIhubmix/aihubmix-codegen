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
- `GO_OBJ_FIELDS` — `go-openai` is a typed struct, so an unmapped object/array parameter is **dropped** from the `go` + `chat` cell (the other six languages are fine). `tests/extensibility.test.ts` fails loudly when this happens.

## Node / CommonJS

The package must be `require()`-able from bare Node — `inferera-web`'s prerender step is a consumer:

```js
const { generateCode } = require('@aihubmix/codegen');
```

TypeScript projects on `moduleResolution: node16 | nodenext` resolve `./dist/index.d.cts` for `require` and `./dist/index.d.ts` for `import`.

## Capability injection layer (unstable)

`generateFromCapabilities()` takes a list of capability keys plus a caller-supplied `resolve(cap, proto)` and produces `{ code, body, notes, used, availability }`. The package never reads the model knowledge base itself — field names and verdicts are injected, which is what keeps it isomorphic.

> **0.x, subject to change.** This layer currently speaks knowledge-base vocabulary (capability keys, verdicts, per-capability sample values). That vocabulary is an open set that grows independently of this package, so it is being moved out to a separate schema package; the interface here will change to take wire-vocabulary input only. Do not depend on its shape yet.

The package ships **no UI**: no chips, no strikethrough styling, no syntax highlighting. Consumers map the structured result onto their own components.

## Invariants

Enforced by tests in `tests/`, not by convention:

1. **Isomorphic** — no DOM, `window`, network, or env reads anywhere in `src/`.
2. **Single wire source** — every renderer's body comes from `buildBody()`; no bypass path.
3. **Facts live once** — auth headers, `anthropic-version`, the four routes, the API-key placeholder, SDK package names and response accessors appear only in `src/config/**`. `tests/fact-localization.test.ts` fails if one leaks into `src/renderers/**` or `scripts/**`.
4. **`CAP_GATED_WIRE_KEYS` is derived**, never hand-written twice.
5. **SDK records are self-consistent** — an `Anthropic` client's response accessor may not contain `choices[`, and an OpenAI client's may not contain `content[0].text`.

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
