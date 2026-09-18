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

/** 占位 state：结构化程序状态（官方主用形态），用户没填时让示例仍能直接跑通。 */
export const DECISION_STATE_PLACEHOLDER: Record<string, string> = {
  subject: 'Duplicate charge',
  message: 'I was charged twice for my subscription this month. Please fix this today.',
};

/**
 * 占位 questions：三种原语各一，同一次请求里混着问（这正是 decision 面的卖点——
 * 所有问题针对同一个 state 并行、互相隔离地评估）。
 *
 * 键名（is_spam / sentiment / urgency）由调用方自取，响应 answers 用同一套键回填，
 * 所以示例里的键要一眼能对上响应。
 */
export const DECISION_QUESTIONS_PLACEHOLDER: Record<string, DecisionQuestion> = {
  is_spam: {
    type: 'noul',
    instructions: 'Is this message spam?',
    criteria: { true: 'Unsolicited or fraudulent', false: 'A genuine customer message' },
  },
  sentiment: {
    type: 'choice',
    instructions: "What is the sender's tone?",
    criteria: {
      calm: 'A neutral or polite message',
      excited: 'An enthusiastic or eager message',
      angry: 'An upset or hostile message',
    },
  },
  urgency: {
    // score 的 criteria 是数组：下标即档位号，响应的 legend / probabilities 用同一套下标当键。
    type: 'score',
    instructions: 'How urgently does this need a reply?',
    criteria: ['Can wait', 'Should be handled this week', 'Needs a reply today'],
  },
};
