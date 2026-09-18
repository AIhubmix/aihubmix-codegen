/**
 * Decision（结构化决策）端点事实。
 *
 * 形态是朴素的单次 JSON POST，但**不是第五个协议**：chat / responses / messages / gemini
 * 四协议是「生成文本」同一件事的四种写法，互为替代；decision 是另一件事——对一份 state
 * 并行评估一组类型化 questions，直接拿回概率化结果，无文本生成、无流式、无消息数组。
 * 所以照 media / realtime 先例走独立入口 generateDecisionCode，**不进 CodeProto 词表**
 * （那张表是「4 协议 × 7 语言」渲染器二维表的索引，扩它会全线破坏）。
 */
import type { DecisionQuestion } from '../types.js';

/** 端点路径（同步单端点，POST，返回体即最终结果）。 */
export const DECISION_PATH = '/v1/systemone';

/**
 * 三种问题原语，逐字出现在请求体 `questions{}.type` 里。
 *
 * **这是 wire 值，不是 canon 词** —— 容易看岔：知识库里那一格的 enum 恰好也是这三个字符串。
 * 但此处写死的依据是「发给网关的 body 里就是这三个值」，属于本包该管的 wire 词汇；
 * tests/vocabulary-isolation 守的是能力键 / verdict / 知识库协议 id 不许进来，两者不冲突。
 */
export const DECISION_TYPES = ['noul', 'choice', 'score'] as const;

/**
 * 占位 state：一段原样的用户来信。
 *
 * 官方两种形态都合法（自然语言 / 结构化程序状态），示例取**自然语言**这一种：
 * 决策面最常见的用法就是拿一段没整理过的文本直接问，省掉「先自己解析成字段」那步。
 */
export const DECISION_STATE_PLACEHOLDER =
  'Hi, I have been trying to connect my Stripe account for 3 days and it keeps failing. I am losing sales. Please help ASAP.';

/**
 * 占位 questions：三种原语各一，同一次请求里混着问（这正是 decision 面的卖点——
 * 所有问题针对同一个 state 并行、互相隔离地评估），且三题共同构成一个完整场景：
 * 工单分诊 —— 派给谁 / 客户多气 / 急不急。
 *
 * 键名（department / frustration / is_urgent）由调用方自取，响应 answers 用同一套键
 * 回填，所以示例里的键要一眼能对上响应。
 *
 * 三题也顺带把 criteria 的三种写法示范全了：
 *  · choice —— **对象**：键是可选项名（回来的 `choice` 就是其中之一），值是这一项的释义；
 *  · score  —— **数组**：下标即档位号，响应的 legend / probabilities 用同一套下标当键；
 *  · noul   —— 可以**整个省掉** criteria，判据写在 instructions 里就够。
 */
export const DECISION_QUESTIONS_PLACEHOLDER: Record<string, DecisionQuestion> = {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this',
    criteria: {
      billing: 'Payment or subscription issues',
      technical: 'Bugs or integration problems',
      sales: 'Pricing or account questions',
    },
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated the customer appears',
    criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
  },
  is_urgent: {
    type: 'noul',
    instructions: 'The message conveys urgency or time-sensitivity',
  },
};
