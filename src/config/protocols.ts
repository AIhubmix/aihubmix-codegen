import type { ProtoDef } from '../types.js';

/** 协议清单 —— 唯一真源。 */
export const PROTOCOLS: ProtoDef[] = [
  { id: 'chat', label: 'Chat Completions' },
  { id: 'messages', label: 'Messages' },
  { id: 'responses', label: 'Responses' },
  { id: 'gemini', label: 'Gemini' },
];
