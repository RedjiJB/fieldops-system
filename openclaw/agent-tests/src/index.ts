// Runs every scenario sequentially against the real gateway/model — not
// parallelized, since these share one model/rate limit and mutate real
// Postgres state that each scenario cleans up around itself.
import { pool } from "./db.js";
import { readOnlyScenarios } from "./scenarios/readOnly.js";
import { mutationScenarios } from "./scenarios/mutations.js";
import { businessRuleScenarios } from "./scenarios/businessRules.js";
import { locationScenarios } from "./scenarios/location.js";
import { guardrailScenarios } from "./scenarios/guardrails.js";
import { reasoningScenarios } from "./scenarios/reasoning.js";
import { replyScenarios } from "./scenarios/replies.js";
import type { Scenario } from "./framework.js";

const scenarios: Scenario[] = [
  ...readOnlyScenarios,
  ...mutationScenarios,
  ...businessRuleScenarios,
  ...locationScenarios,
  ...guardrailScenarios,
  ...reasoningScenarios,
  ...replyScenarios,
];

async function run() {
  console.log(`Running ${scenarios.length} agent tool-calling scenarios against the real gateway...\n`);
  const results: { id: string; passed: boolean; error?: string; durationMs: number }[] = [];

  for (const scenario of scenarios) {
    const start = Date.now();
    process.stdout.write(`- ${scenario.id}: ${scenario.description} ... `);
    try {
      await scenario.run();
      const durationMs = Date.now() - start;
      results.push({ id: scenario.id, passed: true, durationMs });
      console.log(`PASS (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: scenario.id, passed: false, error: message, durationMs });
      console.log(`FAIL (${durationMs}ms)`);
      console.log(`  ${message}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed.`);
  if (failed > 0) {
    console.log(`\nFailures:`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.id}: ${r.error}`);
    }
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
