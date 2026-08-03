/**
 * 能力门控表 —— 「加一个能力」= 加一条记录，而不是在 buildBody 的四个协议分支里各改一处。
 *
 * 为什么能力不能走 emitEnums / emitObjects / emitExtraNumbers 那三条通用兜底通道：
 * 它们**每协议的门控形态不同**，不是同一事实的四种写法，是四种不同语义 ——
 *   - messages：`thinking:{type:'enabled'|'adaptive', budget_tokens}` + `output_config.effort`
 *   - responses：`reasoning:{effort}` 与 `text:{format}`
 *   - chat：扁平的 `reasoning_effort` / `response_format`
 *   - gemini：思考与结构化都不经这里
 * 抽成配置就得发明一套映射 DSL，落在三档划分的反向边界外侧。所以保持代码，只把散落改成集中。
 *
 * `gatedKeys` 声明该能力接管了 ctx.objects 的哪些键 —— CAP_GATED_WIRE_KEYS 由此自动导出，
 * 不再手写第二份（原先两处手写，漏一边就会「关掉能力后残留值仍被发出」）。
 *
 * ⚠️ 数组顺序 == body 键的写入顺序，改顺序会改产物字节。
 */
import type { CodeGenCtx, CodeProto } from '../types.js';
import { inSchema } from './gate.js';
import { chatToolsArr, geminiToolsArr, msgToolsArr, respToolsArr, toolChoiceWire } from './tools.js';
import { chatResponseFormat, msgOutputFormat, respTextFormat } from './structured.js';

type Body = Record<string, unknown>;
type Emit = (b: Body, ctx: CodeGenCtx) => void;

export interface CapabilityDef {
  /** 能力 id（对应 ctx 上的开关字段语义）。 */
  id: string;
  /** 该能力接管的 ctx.objects 键：不走通用 emitObjects，改由本表下发。 */
  gatedKeys: string[];
  /** ctx 上的开关。关掉则整块不发（含 gatedKeys 里的残留值）。 */
  enabled: (ctx: CodeGenCtx) => boolean;
  /** 各协议的下发形态。缺该协议 = 这个协议不支持/不经 body 表达。 */
  emit: Partial<Record<CodeProto, Emit>>;
}

/** parallel_tool_calls：依附 tools，只在 tools 能力开启时下发；schema 未声明该键则不发。 */
function emitParallelToolCalls(b: Body, ctx: CodeGenCtx): void {
  const ptc = (ctx.objects as Record<string, unknown> | undefined)?.parallel_tool_calls;
  if (typeof ptc === 'boolean' && inSchema(ctx, 'parallel_tool_calls')) b.parallel_tool_calls = ptc;
}

/** 取 ctx.objects 里某能力组的子字段（值来自参数面板，随能力一起下发）。 */
function group(ctx: CodeGenCtx, key: string): Record<string, unknown> {
  const objs = (ctx.objects ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return objs[key] ?? {};
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'tools',
    gatedKeys: ['parallel_tool_calls', 'tools[].programmatic_tool_calling'],
    enabled: (ctx) => !!ctx.tools,
    emit: {
      chat: (b, ctx) => {
        b.tools = chatToolsArr(ctx.tools!);
        const tcw = toolChoiceWire('chat', ctx.toolChoice);
        if (tcw !== undefined) b.tool_choice = tcw;
        emitParallelToolCalls(b, ctx);
      },
      messages: (b, ctx) => {
        b.tools = msgToolsArr(ctx.tools!);
        const tcw = toolChoiceWire('messages', ctx.toolChoice);
        if (tcw !== undefined) b.tool_choice = tcw;
        emitParallelToolCalls(b, ctx);
      },
      responses: (b, ctx) => {
        const arr = respToolsArr(ctx.tools!);
        // PTC：schema 声明该 pattern 字段且面板开启时，头部插常量条目（模型在代码环境编排调用其余工具）
        if (ctx.ptc && inSchema(ctx, 'tools[].programmatic_tool_calling'))
          arr.unshift({ type: 'programmatic_tool_calling' } as never);
        b.tools = arr;
        const tcw = toolChoiceWire('responses', ctx.toolChoice);
        if (tcw !== undefined) b.tool_choice = tcw;
        emitParallelToolCalls(b, ctx);
      },
      gemini: (b, ctx) => {
        b.tools = geminiToolsArr(ctx.tools!);
        const tcw = toolChoiceWire('gemini', ctx.toolChoice);
        if (tcw !== undefined) b.toolConfig = tcw;
        emitParallelToolCalls(b, ctx);
      },
    },
  },
  {
    id: 'structured',
    // text 是 responses 的结构化输出组（组内子字段 verbosity 等随能力一起下发）。
    gatedKeys: ['text'],
    enabled: (ctx) => !!ctx.structured,
    emit: {
      chat: (b, ctx) => {
        b.response_format = chatResponseFormat(ctx.structured!);
      },
      messages: (b, ctx) => {
        const fmt = msgOutputFormat(ctx.structured!);
        if (fmt) b.output_config = { format: fmt };
      },
      responses: (b, ctx) => {
        b.text = { ...group(ctx, 'text'), format: respTextFormat(ctx.structured!) };
      },
      // gemini 的结构化输出走 generationConfig.responseMimeType/responseSchema（enum 通道），不在这里。
    },
  },
  {
    id: 'think',
    gatedKeys: ['reasoning', 'thinking'],
    enabled: (ctx) => !!ctx.think,
    emit: {
      chat: (b, ctx) => {
        b.reasoning_effort = ctx.thinkLevel;
      },
      responses: (b, ctx) => {
        b.reasoning = { ...group(ctx, 'reasoning'), effort: ctx.thinkLevel };
      },
      // thinking 是 discriminated union（enabled/disabled/adaptive）。thinkAdaptive（该模型
      // output_config.effort 有真实 enum，含 xhigh 等 budget_tokens 换算表覆盖不到的档位）时走
      // adaptive 形态——effort 直发到 output_config，不经本地换算，与展示的等级选项同一个字段
      // （thinkWireLabel 标的也是 output_config.effort）。否则维持旧 enabled 形态；组内非归能力
      // 子字段走 structParams.thinking，随能力一起下发——同 responses 的 reasoning 处理方式，
      // type/budget_tokens 仍在后覆盖，保证判别式字段不被结构参数误改。
      messages: (b, ctx) => {
        if (ctx.thinkAdaptive) {
          b.thinking = { type: 'adaptive' };
          b.output_config = { ...((b.output_config as Body) ?? {}), effort: ctx.thinkLevel };
        } else {
          // budget_tokens 按类型渲染成数值输入框——原样透传用户填的值，不读不编造本地档位兜底；
          // schema 没给默认值就是没有，没填就不下发，不能拿写死的数字充数。
          b.thinking = { ...group(ctx, 'thinking'), type: 'enabled' };
        }
      },
      // gemini 的 thinkingConfig 尚未接入参数面板，故本表无 gemini 项。
    },
  },
  {
    id: 'webSearch',
    gatedKeys: [],
    enabled: (ctx) => !!ctx.webSearch,
    emit: {
      // provider 侧联网搜索（一次调用即返回结果）。
      chat: (b) => {
        b.web_search_options = {};
      },
    },
  },
];

/**
 * 按表顺序把已开启能力写进 body。
 * 各协议分支在通用参数写完、`stream` 写入之前调一次即可。
 */
export function emitCapabilities(b: Body, ctx: CodeGenCtx, proto: CodeProto): void {
  for (const cap of CAPABILITIES) {
    if (!cap.enabled(ctx)) continue;
    cap.emit[proto]?.(b, ctx);
  }
}

/**
 * 能力接管的 wire 键 —— 由 CAPABILITIES 自动导出，不手写第二份。
 * 这些键不走通用 emitObjects（那样不受能力开关门控，关掉能力后残留值仍会被发出）。
 */
export const CAP_GATED_WIRE_KEYS: ReadonlySet<string> = new Set(
  CAPABILITIES.flatMap((c) => c.gatedKeys),
);
