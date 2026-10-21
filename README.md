# Syllabuddy

Upload your syllabi. Syllabuddy finds every deadline, you check them, and you get a week-by-week study plan that shows where the crunch is before it hits.

Built for the AI Lodge hackathon, track: **Productivity and workflows**.

**Live demo:** hosted by SMU BIA AI Lodge (Next.js frontend on Vercel, API on Cloud Run). The **sample semester works without the AI**; reading a syllabus and "Something changed?" call the AI and are rate limited per visitor.

## 1. Problem Statement

**The problem.** At the start of a semester, a student gets one syllabus per course, and each is written differently: a list, a paragraph, a table, a PDF, a photo of a slide. The deadlines are scattered across them. Nobody adds them up, so the week where three assignments and an exam collide only becomes obvious when it is already on top of them.

**Who has it.** Any university or college student taking several courses at once. Students juggling four or five courses, working part-time, or studying alone without a study group feel it most.

**Why it is worth solving.** Typing every deadline from every syllabus into a calendar is tedious, so most students don't do it, or do it halfway. The cost of missing the pattern is real: cramming, late submissions and lower grades. Spotting a crunch week three weeks ahead gives a student time to act. Spotting it the night before does not.

## 2. Solution Overview

Syllabuddy turns a pile of syllabi into one plan in four steps:

1. **Read.** The student uploads a PDF or photo, or pastes the assessment section. An AI model extracts each assessed item: course, title, type, due date and grade weight.
2. **Check.** Code verifies the AI's output against the syllabus text and flags anything doubtful. The student reviews an editable table before anything is planned.
3. **Plan.** A deterministic scheduler spreads study hours across the days before each deadline, within the student's daily limits, and flags crunch weeks.
4. **Adapt.** The student can say what changed in plain English ("I'm sick from Thursday to Sunday", "the Econ essay is now due 6 November"). The AI proposes small, validated changes, the student approves them, and the plan updates.

The AI does the two things that are hard to do with code: reading messy documents and understanding free-text updates. Everything else, including checking the AI's work, scheduling and crunch detection, is ordinary code that behaves predictably.

## 3. Key Features

- **Syllabus reading** from PDF, image (PNG, JPG, WEBP) or pasted text, for any number of courses. PDFs with a text layer are read as text, so they get the same date checking as pasted text
- **Today dashboard:** hours planned this week against available hours, the next deadline, share of grade due in the next 14 days, items needing attention, and today's study blocks
- **Verification of every extracted item:** each item must quote the line it came from. Quotes are checked against the pasted text, and the date, month and year in the quote must match. Items show a "verified" or "check this" mark
- **Editable review table** with a "Looks right" confirmation for flagged items, and a warning when a course's grade weights don't add up to 100%
- **Week-by-week study plan** (earliest deadline first, with daily hour limits) and **crunch-week detection**: 3 or more deadlines in a week, 40% or more of the grade due, or study time near the limit
- **"Something changed?"**: plain-English updates turned into validated changes that the student approves before they apply (time off, mark done, move a deadline, change study hours)
- **"I fell behind: re-plan from today"** to rebuild the plan from the current date, skipping finished work
- **Calendar export** as an `.ics` file for Google or Apple Calendar
- **Private by default:** the plan is saved only in the student's browser, with a one-click erase
- **Works without the AI** for the planner, dashboard and calendar export (try the built-in sample semester)

## 4. AI Integration

The AI is used in two places. Both go through one module, `lib/llm.ts`.

| Where | What the AI does | What code does |
| --- | --- | --- |
| **Syllabus extraction** (`server/routes/extract.ts`, `lib/extraction.ts`) | Reads a PDF, image or pasted text and returns a fixed JSON structure: course, items, dates, grade weights, and the exact line each item came from | Verifies each quote against the text, checks dates against the quote, flags doubtful items, drops items that look like commands, and sets `done` to false itself. The AI's output is never trusted as-is |
| **Plan changes** (`server/routes/adjust.ts`, `lib/adjust.ts`) | Turns a plain-English message into proposed changes, using only four allowed kinds | Validates every field, drops unknown items and bad dates, writes the plain-English description itself, and applies nothing until the student clicks Apply |

The AI **does not** build the plan. `lib/planner.ts` is deterministic code, so the same inputs always give the same plan and the student can predict what will happen.

**Design choices that go beyond calling an API:**
- **Structured output.** The model must return a fixed JSON shape, not free text.
- **Untrusted input.** The syllabus is treated as data. The prompt says so, and the output is checked for planted instructions.
- **Check and repair.** When the checks find an item whose quoted line isn't in the syllabus, or whose date disagrees with its quote, the AI is sent just those items with the exact problem and asked to look again. Its answer goes through the same checks, so the AI never grades its own work. Anything still wrong is left for the student.
- **Reliability.** Each call has a timeout, up to three attempts with backoff, and a fallback to another provider or model when one is busy or retired. These failure paths are tested with a simulated AI service (busy, retired model, timeout, bad JSON, rejected key).
- **Visible behaviour.** Under the table, the app says which model read the syllabus, how long it took, whether a backup answered, and what the repair step did.
- **Human in the loop.** A review step sits between extraction and planning, and between the AI's proposed changes and the plan.

## 5. External Tools & Datasets

**AI models**
- **OpenRouter** chat completions API with structured JSON output (`json_schema`, falling back to `json_object`). Images are sent as `image_url` data URIs and scanned PDFs as OpenRouter `file` parts. The default model is `google/gemini-2.5-flash` (`OPENROUTER_MODEL`), with `google/gemini-2.5-flash-lite` as the backup (`OPENROUTER_FALLBACK_MODEL`). The evaluation below ran on Gemini `gemini-3.6-flash` through Google's own API, before the move to OpenRouter.

**Libraries**
- Next.js 15 (App Router), React 19 and TypeScript for the frontend
- Express 5, `multer` and `cors` for the API, bundled with `esbuild`
- `@upstash/redis` for the shared AI Lodge rate limiter
- `unpdf` to read the text layer of PDFs on the server
- `tsx` for the tests and evaluation scripts
- Google Fonts: Bricolage Grotesque and Hanken Grotesk

**Datasets.** None. There is no training data and no external dataset. The test syllabi in `eval/cases.ts` and the sample semester in `lib/sample.ts` were written by us for this project.

## 6. Installation & Setup

**You need:** Node.js 22 or newer and an [OpenRouter](https://openrouter.ai/keys) API key.

The app has two parts: a Next.js frontend (`app/`, `components/`) and a small Express API (`server/`) that makes the AI calls. Both reuse the code in `lib/`.

```bash
# 1. Get the code and install
git clone https://github.com/smubia-projects/ail-ay2627-s1-joshua-syllabuddy.git
cd ail-ay2627-s1-joshua-syllabuddy
npm install

# 2. Configure the API: copy .env.example to .env and set OPENROUTER_API_KEY
cp .env.example .env

# 3. Start the API (http://localhost:8080) and, in a second terminal, the frontend
npm run dev:server
npm run dev
# open http://localhost:3000
```

The frontend calls `NEXT_PUBLIC_API_BASE` (default `http://localhost:8080`; see `.env.local.example`).

**API settings** (`.env`, see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter key (required for the AI features) |
| `OPENROUTER_MODEL` | Main model, default `google/gemini-2.5-flash` |
| `OPENROUTER_FALLBACK_MODEL` | Backup model, default `google/gemini-2.5-flash-lite` |
| `CORS_ORIGINS` | Comma-separated frontend origins allowed to call the API |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared rate-limit store. Unset means no limiting |
| `RATE_LIMIT_EXTRACT_MAX`, `RATE_LIMIT_ADJUST_MAX`, `RATE_LIMIT_WINDOW_SECONDS` | Fallback limits per IP (default 5 per 5 days) |

**Deployment.** The API is built from the root `Dockerfile` (esbuild bundles `server/` and `lib/` into `server/dist/server.js`) and deployed to Cloud Run by `.github/workflows/deploy.yml`, with its env vars from the `DOTENV` repo secret. The frontend is a Vercel project on the repo root (`vercel.json`, Next.js preset) with `NEXT_PUBLIC_API_BASE` set to the Cloud Run URL. `GET /api/health` returns `{"status":"ok"}`.

**No key?** Click **Try a sample semester**. The planner, dashboard and calendar export work without the AI. Reading syllabi and "Something changed?" need a key.

**Try the safety demo:** on the intake panel, click **Fill in injection test**, then **Extract deadlines**.

**Run the tests** (no key needed):

```bash
npm test
```

**Run the evaluation** (needs a key; calls the real model and writes `eval/results.md`):

```bash
npm run eval              # one run
npm run eval -- --runs=3  # three runs, to check the results are consistent
```

**Troubleshooting**
- *"The AI service is busy"*: the model is sometimes overloaded. The app retries and falls back to the backup model automatically. Wait a moment and try again.
- *"Couldn't reach the Syllabuddy server"*: the API isn't running, or `NEXT_PUBLIC_API_BASE` / `CORS_ORIGINS` don't match.
- *`.env` changes not picked up*: restart `npm run dev:server`. `NEXT_PUBLIC_API_BASE` is read at build time, so restart `npm run dev` (or rebuild) after changing it.
- *Project inside OneDrive and `npm run dev` fails with `EINVAL readlink`*: delete the `.next` folder, or move the project out of OneDrive.

## 7. AI Safety & Limitations

The syllabus a student uploads is untrusted, and the model can be wrong or be tricked. The design assumes both and checks everything the model returns before the student relies on it. The full risk table is in [`SAFETY.md`](./SAFETY.md).

### Main risks and guardrails

| Risk | Guardrail |
| --- | --- |
| **Prompt injection** (a syllabus says "ignore previous instructions…") | The prompt treats the syllabus as data. Output is a fixed structure. Input and output are scanned for instruction-like text, command-like items are dropped, and the student is warned. Item status (`done`) is never taken from the model |
| **Wrong or invented dates** | Each item must quote its source line. The server checks the quote exists and that its date, month and year match. Dates worked out from week numbers, and dates far in the past or future, are flagged |
| **Missed or misread grade weights** | Weights are totalled per course, and the student is warned when they don't add up to 100% |
| **Over-trusting the AI** | A human review step sits before planning. Every field is editable. The plan is built by deterministic code, not by the model |
| **AI acting on its own** | The model can only propose four kinds of change. Code validates each one, and nothing applies until the student approves |
| **Service failures** | Timeouts, retries with backoff, provider and model fallback, and clear error messages. The planner works without the AI |
| **Privacy** | Files are processed in memory and not stored on a server. The plan is saved only in the student's browser, with one-click erase. API keys stay on the server |
| **Abuse and cost** | 10 MB file limit, 60,000 character text limit, a 100-item cap and field length limits |

### Testing done

- **Unit tests** (`npm test`, no key needed) cover the planner, the safety checks (20), the plan-change validation (14), the evaluation scoring (9), the dashboard (6), PDF reading (6), **the AI client against a simulated service that is busy, retired, slow or confused (16)**, **the check-and-repair step (10)** and **the whole read, check and repair flow (4)**. They include a case where the model is assumed to have obeyed a planted instruction, plus fabricated quotes, wrong dates, a "fix" that is itself wrong, and oversized output. These use simulated model output.
- **Evaluation on a real model** (`npm run eval`): six test syllabi with known answers, including a list, prose, week numbers, a numeric-date table and two attack syllabi. Run on 2026-10-16 with Gemini `gemini-3.6-flash`, after the check-and-repair step was added:

| Measure | Result |
| --- | --- |
| Deadlines found | 24 of 24 |
| Dates correct | 24 of 24 |
| Grade weights correct | 23 of 23 |
| Invented items | 0 |
| Attack syllabi where the model followed the planted instruction | 0 of 2 |
| Attack syllabi where the injection warning was shown | 2 of 2 |
| Items the model marked as done | 0 |

The full report is in [`eval/results.md`](./eval/results.md).

### Limitations

- **Small test set.** Six syllabi is a rough guide, not a guarantee. A different model, or a syllabus unlike these, could do worse.
- **Quote checking needs readable text.** It works on pasted text and on PDFs with a text layer. For scanned PDFs and photos there is no text to check against, so those items get plausibility checks and a warning to compare against the original.
- **The injection scan is pattern-based.** It catches common attacks and not every phrasing. It is one layer, alongside the fixed output structure and the human review step.
- **Wrong-date flagging is not exercised by the real-model run.** The model made no wrong dates in the evaluation, so that path is covered by unit tests with simulated bad output.
- **Study-hour estimates are rough.** They are a starting point, and every item's hours can be changed.
- **No sign-in.** The public demo is limited per visitor IP instead (a few AI requests per window, set centrally).
- **Data terms.** The syllabus is sent to the AI provider. Check the provider's terms before using real student material, because free tiers can differ from paid ones.

## Project structure

```
app/            Next.js page (frontend only, deployed to Vercel)
server/         Express API for Cloud Run (/api/health, /api/extract, /api/adjust) and the rate limiter
components/     Intake, Dashboard, ReviewTable, AdjustPanel, PlanView
lib/            planner, safety checks, AI client, extraction prompt, calendar export
eval/           test syllabi, scoring, and the latest results
scripts/        tests and the evaluation runner
SAFETY.md       full risk table and measured results
ARCHITECTURE.md a one-page guide to how the code fits together
```
