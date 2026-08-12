export type ScenarioFn = () => Promise<void>;
export type Scenario = { id: string; description: string; run: ScenarioFn };

export class ScenarioAssertionError extends Error {}

export function assertToolCalled(tools: string[], expected: string, context: string): void {
  if (!tools.includes(expected)) {
    throw new ScenarioAssertionError(
      `${context}: expected tool "${expected}" to be called, got [${tools.join(", ")}]`,
    );
  }
}

export function assertToolNotCalled(tools: string[], notExpected: string, context: string): void {
  if (tools.includes(notExpected)) {
    throw new ScenarioAssertionError(`${context}: expected tool "${notExpected}" NOT to be called, but it was`);
  }
}

export function assertNoToolsCalled(tools: string[], context: string): void {
  if (tools.length > 0) {
    throw new ScenarioAssertionError(`${context}: expected no tool calls, got [${tools.join(", ")}]`);
  }
}

export function assertAnyToolCalled(tools: string[], candidates: string[], context: string): void {
  if (!candidates.some((c) => tools.includes(c))) {
    throw new ScenarioAssertionError(
      `${context}: expected one of [${candidates.join(", ")}] to be called, got [${tools.join(", ")}]`,
    );
  }
}

export function assertTrue(cond: boolean, message: string): void {
  if (!cond) throw new ScenarioAssertionError(message);
}
