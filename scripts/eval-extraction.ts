import { mkdirSync, writeFileSync } from "node:fs";
import { CASES } from "../eval/cases";
import { aggregate, failedScore, renderReport, scoreCase, type CaseScore } from "../eval/score";
import { runExtraction } from "../lib/pipeline";
import { describeProvider, hasApiKey } from "../lib/llm";

/**
 * Runs the real syllabus-reading step on test syllabi with known answers and
 * writes the scores to eval/results.md. Needs OPENROUTER_API_KEY in .env:
 *
 *   npm run eval
 */

const RUNS = Math.max(1, Number(process.argv.find((x) => x.startsWith("--runs="))?.split("=")[1] ?? 1));

async function runOnce(label: string) {
  const scores: CaseScore[] = [];
  const outputs: Record<string, unknown> = {};
  for (const c of CASES) {
    process.stdout.write(`${label}"${c.name}"... `);
    try {
      const out = await runExtraction({ text: c.text, today: c.today });
      const s = scoreCase(c, out.raw, out.result);
      s.wrongDatesBeforeRepair = scoreCase(c, out.firstRaw, out.firstResult).wrongDates;
      s.repair = out.result.meta?.repair;
      s.ms = out.result.meta?.ms;
      s.calls = out.result.meta?.calls;
      scores.push(s);
      outputs[c.id] = { raw: out.raw, firstRaw: out.firstRaw, processed: out.result };
      console.log(`found ${s.found}/${s.expected}, correct dates ${s.dateCorrect}/${s.found}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      scores.push(failedScore(c, msg));
      console.log(`failed: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 2500)); // be gentle with free-tier rate limits
  }
  return { scores, outputs };
}

async function main() {
  if (!hasApiKey()) {
    console.error("No API key found. Add OPENROUTER_API_KEY to .env, then run: npm run eval");
    process.exit(1);
  }

  const runs: CaseScore[][] = [];
  let outputs: Record<string, unknown> = {};
  for (let r = 1; r <= RUNS; r++) {
    const res = await runOnce(RUNS > 1 ? `[run ${r}/${RUNS}] ` : "Running ");
    runs.push(res.scores);
    outputs = res.outputs;
  }
  const scores = runs[runs.length - 1];

  const extra: string[] = [];
  if (RUNS > 1) {
    const key = (s: CaseScore) => `${s.found}/${s.dateCorrect}/${s.weightCorrect}/${s.extra}/${s.error ? "x" : "ok"}`;
    const same = scores.every((_, i) => new Set(runs.map((r) => key(r[i]))).size === 1);
    extra.push(
      `## Consistency across ${RUNS} runs`,
      "",
      ...runs.map((r, i) => {
        const a = aggregate(r);
        return `- Run ${i + 1}: found ${a.found} of ${a.expected}, correct dates ${a.dateCorrect} of ${a.found}, invented ${a.extra}, failed cases ${a.failedCases}`;
      }),
      "",
      same
        ? "Every case gave the same result in every run."
        : "Some cases gave different results between runs. Check the per-run lines above, and treat single-run numbers as approximate.",
    );
  }

  const report = renderReport(scores, {
    date: new Date().toISOString().slice(0, 10),
    provider: describeProvider(),
    extra,
  });
  mkdirSync("eval", { recursive: true });
  writeFileSync("eval/results.md", report);
  writeFileSync("eval/raw-output.json", JSON.stringify(outputs, null, 2));
  console.log(`\n${report}\nSaved to eval/results.md (raw model output in eval/raw-output.json).`);
}

main();
