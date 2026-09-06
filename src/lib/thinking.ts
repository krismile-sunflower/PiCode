import type { PiReasoningLevel } from './types';

/** Thinking levels PiCode operates with; Pi clamps to what the model supports. */
export const THINKING_LEVELS: PiReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export const THINKING_LEVEL_LABELS: Record<PiReasoningLevel, string> = {
  off: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '最高',
};

export function thinkingLevelLabel(level: string): string {
  return THINKING_LEVEL_LABELS[level as PiReasoningLevel] || level;
}
