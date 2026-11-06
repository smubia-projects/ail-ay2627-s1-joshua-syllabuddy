# How Syllabuddy works

A one-page guide to the code. The short version: **the AI reads and understands; plain code decides, checks and schedules.**

```
syllabus (text / PDF / image)
        |
        v
  POST /api/extract  ->  lib/pipeline.ts
        |                   |
        |        1. read    lib/extraction.ts + lib/llm.ts     (AI, OpenRouter)
        |        2. check   lib/safety.ts                      (code)
        |        3. repair  lib/repair.ts                      (AI once, then code re-checks)
        v
  review table  ->  student edits / confirms  ->  lib/planner.ts  ->  plan, crunch weeks, .ics
                                                       ^
        "Something changed?"  ->  POST /api/adjust  ->  lib/adjust.ts (validates)  ->  student approves
```

Deployment: the page (`app/`, `components/`) is a static Next.js frontend on Vercel. The two AI routes run in a small Express API (`server/`, bundled with esbuild, on Cloud Run) that imports the same `lib/` code. The frontend reaches it through `lib/api.ts` and `NEXT_PUBLIC_API_BASE`, and both AI routes go through the shared AI Lodge rate limiter (`server/rateLimit.ts`).

## Where things are

| Area | Files | What it does |
| --- | --- | --- |
| Screens | `app/page.tsx`, `components/` | Three steps: add a syllabus, check the deadlines, your plan. The plan is stored only in the browser (`localStorage`). |
| Reading | `lib/extraction.ts`, `lib/llm.ts`, `server/routes/extract.ts` | Sends the syllabus to the AI and asks for structured JSON. `llm.ts` handles timeouts, retries, backup models and clear error messages. |
| Checking | `lib/safety.ts` | Verifies every item against the source text (see below). |
| Repair | `lib/repair.ts`, `lib/pipeline.ts` | Items that fail a check are sent back to the AI once, with the exact problem. The answer goes through the same checks again. |
| Planning | `lib/planner.ts`, `lib/dashboard.ts`, `lib/summary.ts` | Pure code, no AI. Spreads study hours before each deadline and finds crunch weeks. |
| Changes | `lib/adjust.ts`, `server/routes/adjust.ts` | Turns a plain-English update into at most four kinds of change, then validates each one. |
| Calendar | `lib/ics.ts` | Builds the downloadable `.ics` file. |
| Proof | `scripts/test-*.ts`, `eval/`, `SAFETY.md` | Automated tests (simulated AI) and an evaluation against a real model. |

## The checks on AI output (`lib/safety.ts`)

The syllabus is treated as untrusted data. For every item the AI returns:

1. **Quote check.** The item must quote a line from the syllabus, and that line must really appear in the text (text is normalised first, so PDF quirks like ligatures and split words don't cause false alarms).
2. **Date check.** If the quote states a date, the extracted date must agree with it (day, month and, when written, year).
3. **Injection scan.** Both the syllabus and the AI output are scanned for text that tries to instruct an AI. A match shows a warning; the text is never followed.
4. **Fixed shape.** Output must match a fixed schema, with item types limited to a known list and sizes capped. `done` is never taken from the AI.
5. **Weights.** If a course's grade weights don't add up to 100%, the student is warned.
6. **Human review.** Everything lands in a table the student can edit before any plan exists. Items that can't be verified are marked.

Scans and photos have no text to check a quote against, so those items are all flagged and say so.

## The planner (`lib/planner.ts`)

- Each item type has a lead time (an exam starts 14 days out, a quiz 4) and a base effort. Heavier grade weight adds hours, capped.
- Items are handled earliest deadline first. Each half hour goes to the day, inside the item's lead window, with the most free capacity. This spreads work out instead of piling it on the last night.
- A week is a **crunch week** if it has 3 or more deadlines, 40% or more of the grade due, or planned study within 85% of the student's weekly limit. The reason is shown.

## Changes are proposals, not actions (`lib/adjust.ts`)

The AI may only propose: time off, move a deadline, mark an item done, or change an item's hours. Code validates dates, ranges and item IDs, drops anything bad, writes the description the student sees in its own words, and applies nothing until the student clicks **Apply and re-plan**.

## Reliability (`lib/llm.ts`)

Free-tier models get busy or retired. The client uses a per-call timeout and a total time budget, retries with backoff, tries other Flash models, rests a failing model for a few minutes, and turns raw errors into one plain sentence. All of this is tested against a simulated AI service in `scripts/test-llm.ts`.

## Honest limits

See `SAFETY.md`: small evaluation set, injection scan is pattern-based, scans can't be quote-checked, no sign-in (the AI routes are rate limited per IP instead).
