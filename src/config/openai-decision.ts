/**
 * OpenAI Decisions（POST /v1/decisions）端点事实。
 *
 * 与 config/decision.ts（/v1/systemone）是**两个不同的端点**，不是同一件事的两种写法：
 * 请求体、题型名、答案形状都不一样 —— 那边是 `state` + 按键名索引的 `questions{}`，答案回一张
 * `answers{}` 表；这边是 `input` + **有序** `questions[]`，答案按提问顺序回一个 `answers[]` 数组，
 * 题型叫 `predicate` 不叫 `noul`，选项与档位分别放 `choices[]` / `levels[]`。所以各走各的入口、
 * 各有一张渲染器表，body builder 互不复用。
 *
 * 字段形状对照 openai/openai-openapi 的 DecisionRequest / DecisionResponse（main@0ef225c4f，
 * 2026-10-08）；占位示例取自 2026-10-09 经网关线上实测 200 的那次请求（改写为英文）。
 */
import type { OpenAIDecisionQuestion } from '../types.js';

/** 端点路径（同步单端点，POST，返回体即最终结果；请求体没有 stream 字段）。 */
export const OPENAI_DECISION_PATH = '/v1/decisions';

/**
 * 三种题型，逐字出现在请求体 `questions[].type` 里（wire 值）。
 * 答案侧另有第四种 `refusal`（该题被拒答，只带 name），只出现在响应里，不能拿来提问。
 */
export const OPENAI_DECISION_TYPES = ['predicate', 'choice', 'score'] as const;

/** Python / TypeScript 示例所用官方 SDK 的事实（其余五门语言走原生 HTTP）。 */
export interface OpenAIDecisionSdkDef {
  /** 安装命令 —— 带版本下限，渲染进生成代码的第一行注释。 */
  install: string;
  /** import 行，逐行原样出。 */
  imports: string[];
  /** 客户端构造表达式（不含参数）。 */
  clientCtor: string;
  /** 接在 baseUrl 后的路径后缀：SDK 请求 `{base_url}/decisions`，拼起来正好是 OPENAI_DECISION_PATH。 */
  baseSuffix: string;
  /** 调用表达式（不含参数）。 */
  call: string;
}

/**
 * `client.decisions.create` 是 2026-10-06 才进的官方 SDK：openai-python 3.26.0（3.25.0 的 wheel 里
 * 还没有 resources/decisions）、openai-node 7.30.0（CHANGELOG「add standalone Decisions support」）。
 * 旧版本上这个属性不存在（python AttributeError / node TypeError），所以版本下限必须跟着示例走，
 * 只写在网页别处留不住 —— 用户复制走的是代码。
 */
export const OPENAI_DECISION_SDK: Record<'python' | 'javascript', OpenAIDecisionSdkDef> = {
  python: {
    install: 'pip install -U "openai>=3.26.0"',
    imports: ['from openai import OpenAI'],
    clientCtor: 'OpenAI',
    baseSuffix: '/v1',
    call: 'client.decisions.create',
  },
  javascript: {
    install: 'npm install "openai@>=7.30.0"',
    imports: ['import OpenAI from "openai";'],
    clientCtor: 'new OpenAI',
    baseSuffix: '/v1',
    call: 'client.decisions.create',
  },
};

/**
 * 占位 input：一段原样的用户反馈（客服分诊场景）。
 *
 * 刻意不带单引号：cURL 示例把 body 包在 shell 单引号里，带 `'` 就得渲染成 `'\''`，
 * 默认示例读起来像乱码。用户自己的输入照常经 shellSafe 转义，不受这条约束。
 */
export const OPENAI_DECISION_INPUT_PLACEHOLDER =
  'I was charged twice for my order last week. The refund has not arrived and support is not replying.';

/**
 * 占位 questions：三种题型各一，同一次请求里对同一段 input 提问 —— 是不是账单问题（predicate）、
 * 派给哪个团队（choice）、有多急（score）。三题都带 name，答案用同一个 name 回显，示例里一眼能对上。
 *
 * score 的 levels 按官方要求**从低到高**排列：答案的 score 是档位下标（从 0 起）的概率加权平均，
 * 可以落在两档之间，所以顺序就是刻度。
 */
export const OPENAI_DECISION_QUESTIONS_PLACEHOLDER: OpenAIDecisionQuestion[] = [
  {
    type: 'predicate',
    name: 'is_billing_issue',
    instructions: 'Is this feedback about a charge, an invoice, or a refund?',
  },
  {
    type: 'choice',
    name: 'department',
    instructions: 'Which team should handle this feedback?',
    choices: [
      { value: 'billing', description: 'Payments, invoices, and refunds.' },
      { value: 'technical', description: 'Technical problems while using the product.' },
      { value: 'shipping', description: 'Delivery and package tracking.' },
      { value: 'other', description: 'Requests that fit none of the above.' },
    ],
  },
  {
    type: 'score',
    name: 'urgency',
    instructions: 'How urgent is this feedback?',
    levels: [
      { label: 'low', description: 'A general question with no impact on usage or money.' },
      { label: 'medium', description: 'Hurts the experience, but no money is lost.' },
      { label: 'high', description: 'Money is lost or the customer is clearly upset.' },
    ],
  },
];
