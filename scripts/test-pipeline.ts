process.env.OPENROUTER_API_KEY = "test-key-test-key-test-key-1234";
process.env.LLM_BACKOFF_MS = "0";

import assert from "node:assert/strict";
import { CASES } from "../eval/cases";

/**
 * The whole read -> check -> repair flow, against a pretend OpenRouter whose first
 * answer has a wrong date and an invented item, and whose second answer corrects them.
 */

const c = CASES.find((x) => x.id === "list")!;
const reply = (data: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(data) } }] }), { status: 200 });

async function main() {
  const { runExtraction } = await import("../lib/pipeline");
  const { describeRead } = await import("../lib/meta");

  let calls = 0;
  const prompts: string[] = [];
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    prompts.push(String(init?.body));
    if (calls === 1) {
      return reply({
        course: "ECON1101",
        items: [
          { title: "Midterm exam", type: "exam", dueDate: "2026-10-23", weightPct: 30, evidence: "Midterm exam: Friday 23 October 2026" },
          { title: "Final exam", type: "exam", dueDate: "2026-12-17", weightPct: 35, evidence: "Final exam: 7 December 2026" },
          { title: "Group project", type: "project", dueDate: "2026-11-20", weightPct: 20, evidence: "Group project due 20 November" },
        ],
      });
    }
    return reply({
      fixes: [
        { index: 1, action: "fix", dueDate: "2026-12-07", evidence: "Final exam: 7 December 2026" },
        { index: 2, action: "remove" },
      ],
    });
  }) as typeof fetch;

  const out = await runExtraction({ text: c.text, today: c.today });

  console.log("Whole pipeline");
  assert.equal(calls, 2, "one read and one repair call");
  assert.ok(prompts[1].includes("Final exam") && prompts[1].includes("Group project"));
  assert.ok(!prompts[1].includes("Midterm exam\", date"), "the good item is not sent back");

  assert.equal(out.firstResult.items.length, 3);
  assert.equal(out.result.items.length, 2);
  assert.equal(out.result.items.find((i) => i.title === "Final exam")!.dueDate, "2026-12-07");
  assert.ok(out.result.items.every((i) => i.verified && !i.verify), "everything left is verified");
  console.log("  ok  a wrong date is fixed and an invented item removed, then re-verified by code");

  const m = out.result.meta!;
  assert.equal(m.calls, 2);
  assert.deepEqual(m.repair, { attempted: 2, fixed: 1, removed: 1, stillFlagged: 0 });
  assert.ok(out.result.warnings[0].includes("sent back to the AI"));
  console.log("  ok  the result reports what happened");

  const line = describeRead(m);
  assert.ok(line.includes("Gemini 2.5 Flash") && line.includes("1 fixed, 1 removed"));
  assert.ok(!line.includes("retr"), "a repair call is not counted as a retry");
  console.log("  ok  the 'how this was read' line is accurate");

  // A PDF/photo read has nothing to check against, so there is no repair step.
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return reply({ course: "X", items: [{ title: "Quiz", type: "quiz", dueDate: "2026-10-16", weightPct: 5, evidence: "Quiz 16 Oct" }] });
  }) as typeof fetch;
  const scan = await runExtraction({ file: { mime: "image/png", data: "AAAA" }, today: c.today });
  assert.equal(calls, 1);
  assert.equal(scan.result.meta!.repair, undefined);
  assert.ok(describeRead(scan.result.meta!).includes("can't be checked against text"));
  console.log("  ok  a scan or photo is read once, and the line says it can't be checked");

  console.log("\nAll 4 pipeline tests passed.");
}
main();
