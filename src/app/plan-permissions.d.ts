declare module '@picode-plan-permissions' {
  export interface PlanStep {
    id: string;
    title: string;
    detail?: string;
    status: 'pending' | 'in_progress' | 'complete' | 'blocked';
  }

  export interface PlanSessionState {
    phase: 'build' | 'plan' | 'review' | 'executing' | 'complete';
    goal: string;
    steps: PlanStep[];
    updatedAt: string;
  }

  /** Extension entry point Pi calls with its ExtensionAPI. */
  const planPermissions: (pi: unknown) => void;
  export default planPermissions;

  export function isSafePlanBash(command: unknown): boolean;
  export function isPlanToolAllowed(toolName: unknown, input: unknown): boolean;
  export function builtinPlanToolNames(tools: readonly unknown[]): string[];
  export function gitConfigIsHostile(configText: string): boolean;
  export function bashScope(command: unknown): string;
  export function allowanceScope(sessionId: string, toolName: string, input: unknown): string;
  export function sessionIdOf(entries: readonly unknown[]): string;
  export function planMarkers(text: string, marker: 'DONE' | 'BLOCKED'): Set<number>;
  export const PLAN_PROGRESS_TOOL: string;
  export function applyPlanProgress(
    state: PlanSessionState,
    step: number,
    status: 'complete' | 'blocked',
  ): PlanSessionState;
  export function parsePlanResponse(text: string, existing: PlanSessionState): PlanStep[];
  export function applyPlanExecutionMarkers(
    state: PlanSessionState,
    completed: ReadonlySet<number>,
    blocked: ReadonlySet<number>,
  ): PlanSessionState;
}
