/**
 * One place that talks to the AI provider.
 *
 * - Every call goes through OpenRouter's chat completions API
 *   (OPENROUTER_API_KEY), using OPENROUTER_MODEL with OPENROUTER_FALLBACK_MODEL
 *   as the backup when the main model is busy, retired or slow.
 * - Output is always forced into a fixed JSON structure.
 * - Each call has a timeout, and transient failures (rate limits, server
 *   errors, network drops, malformed JSON) are retried with backoff.
 */

const openrouterUrl = () => `${((process.env.API_BASE_URL || process.env.OPENROUTER_BASE_URL)?.trim() || "https://api.apiyi.com/v1").replace(/\/+$/, "")}/chat/completions`;
// Read at call time so tests and scripts can change them after import.
const mainModel = () => (process.env.MODEL_NAME || process.env.OPENROUTER_MODEL)?.trim() || "gemini-3.5-flash-lite";
const fallbackModel = () => (process.env.FALLBACK_MODEL_NAME || process.env.OPENROUTER_FALLBACK_MODEL)?.trim() || "gemini-3.1-flash-lite";
// Short enough that a model that has stopped answering is skipped for the backup model.
const TIMEOUT_MS = 22_000;
const MAX_ATTEMPTS = 3;
// Stop retrying once this much time has passed, so a request never outlives the route's time limit.
const RETRY_BUDGET_MS = 40_000;

export const NO_KEY_MESSAGE =
  "No API key is set. Add OPENROUTER_API_KEY to the server's environment and restart it.";

/** Ignore empty values and copied placeholders like "your-key-here". */
const looksReal = (k?: string) => !!k && k.trim().length >= 20 && !/^your[-_ ]/i.test(k.trim());

function apiKey(): string | undefined {
  const k = (process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim();
  return looksReal(k) ? k : undefined;
}

/** Which model will be tried first, for labelling evaluation results. */
export function describeProvider(): string {
  if (!apiKey()) return "no provider configured";
  return `OpenRouter (${mainModel()}, with fallback to ${fallbackModel()} if busy)`;
}

export function hasApiKey(): boolean {
  return !!apiKey();
}

/** A plain JSON Schema object, as sent in OpenRouter's response_format. */
export type JsonSchema = Record<string, unknown>;

export interface GenerateOptions {
  instructions: string;
  /** Untrusted or user-supplied text, already wrapped in tags by the caller. */
  textParts?: string[];
  /** A PDF or image, base64 encoded. */
  file?: { mime: string; data: string } | null;
  /** Short identifier for the structured output, e.g. "record_syllabus_items". */
  toolName: string;
  toolDescription: string;
  schema: JsonSchema;
  /** If the model answers with a bare list, wrap it under this key (e.g. "items"). */
  arrayKey?: string;
  /** Plain-text description of the JSON shape, added to the prompt for every model. */
  shapeHint: string;
}

export interface CallMeta {
  provider: "openrouter";
  model: string;
  calls: number;
  ms: number;
  fellBack: boolean;
}

/** Filled in as a request moves through retries and fallbacks. */
interface Trace {
  model: string;
  calls: number;
  /** When the whole request must be finished, so it never outlives the route's time limit. */
  deadline?: number;
}

/** Time allowed for one AI request in total, retries and the backup model included. */
const TOTAL_BUDGET_MS = 45_000;

/** How long one call may take: the usual limit, or whatever is left of the total budget. */
function callTimeout(t?: Trace): number {
  if (!t?.deadline) return TIMEOUT_MS;
  const left = t.deadline - Date.now();
  if (left < 4_000) {
    throw Object.assign(new Error("Out of time"), { name: "TimeoutError" });
  }
  return Math.min(TIMEOUT_MS, left);
}

const versionOf = (name: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);

function userContent(o: GenerateOptions): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  if (o.file) {
    // Images and PDFs both go as data URLs: apiyi's Gemini models read a PDF this way and ignore `file` parts.
    content.push({ type: "image_url", image_url: { url: `data:${o.file.mime};base64,${o.file.data}` } });
  }
  for (const t of o.textParts ?? []) content.push({ type: "text", text: t });
  content.push({ type: "text", text: `${o.instructions}\n\nReply with JSON only, in exactly this shape:\n${o.shapeHint}` });
  return content;
}

class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function errorFor(status: number, detail: string): HttpError {
  const message =
    status === 429 || status === 502 || status === 503
      ? "The AI service is busy right now. Wait a few seconds and try again."
      : status === 404 || (status === 400 && /not a valid model|model.*not found|no endpoints/i.test(detail))
        ? "That AI model is no longer available. Set OPENROUTER_MODEL to a current model."
        : status === 401 || status === 403
          ? "The AI key was rejected. Check OPENROUTER_API_KEY and restart the server."
          : status === 402
            ? "The AI account is out of credits. Try again later."
            : `OpenRouter returned ${status}: ${detail}`;
  // A retired or unknown model is reported as 404 so the fallback logic treats it as "gone".
  const code = status === 400 && /not a valid model|model.*not found|no endpoints/i.test(detail) ? 404 : status;
  return new HttpError(message, code);
}

async function viaOpenRouter(o: GenerateOptions, key: string, model: string, t?: Trace): Promise<unknown> {
  const messages = [{ role: "user", content: userContent(o) }];
  // Reading a syllabus doesn't need long "thinking", which is most of the wait on newer Flash models.
  // Some models reject a reasoning or json_schema setting; a 400 about either is retried once
  // with the plainer request (no reasoning setting, json_object output).
  const call = (plain: boolean) =>
    fetch(openrouterUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": "Syllabuddy",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: 8192,
        response_format: plain
          ? { type: "json_object" }
          : {
              type: "json_schema",
              json_schema: { name: o.toolName, description: o.toolDescription, strict: false, schema: o.schema },
            },
        ...(plain ? {} : { reasoning: { effort: versionOf(model) >= 3 ? "low" : "none", exclude: true } }),
      }),
      signal: AbortSignal.timeout(callTimeout(t)),
    });
  let res = await call(false);
  if (res.status === 400) {
    const body = await res.clone().text();
    if (/reason|think|effort|schema|response_format|json/i.test(body)) res = await call(true);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw errorFor(res.status, detail);
  }

  const json = (await res.json()) as {
    error?: { code?: number; message?: string };
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> | null }; error?: { code?: number; message?: string } }>;
  };
  const failure = json.error ?? json.choices?.[0]?.error;
  if (failure) throw errorFor(Number(failure.code) || 502, String(failure.message ?? "").slice(0, 300));
  const raw = json.choices?.[0]?.message?.content;
  const out = Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : (raw ?? "");
  if (!out) throw new Error("The AI returned no content.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("The AI returned something that wasn't valid JSON.");
  }
  if (t) t.model = model;
  return parsed;
}

// ---- Model fallback ---------------------------------------------------------
// Models get overloaded or retired. When the main model is busy or gone, the
// backup model from OPENROUTER_FALLBACK_MODEL is tried.

const statusOf = (err: unknown) => (err as { status?: number }).status;
const isCapacityError = (err: unknown) => [404, 408, 429, 502, 503].includes(statusOf(err) ?? 0) || isTimeout(err);

// A model that just ran out of quota or was overloaded is skipped for a few minutes,
// so the next request doesn't spend its time budget asking it again.
const cooldown = new Map<string, number>();
const isCooling = (model: string) => (cooldown.get(model) ?? 0) > Date.now();
function cool(model: string, err: unknown) {
  const minutes = statusOf(err) === 404 ? 60 : statusOf(err) === 429 ? 5 : 2;
  cooldown.set(model, Date.now() + minutes * 60_000);
}

/** For tests: forget which models are resting. */
export function resetModelCache() {
  cooldown.clear();
}

async function viaOpenRouterWithFallback(o: GenerateOptions, key: string, t?: Trace): Promise<unknown> {
  const attempt = async (model: string) => {
    try {
      return await viaOpenRouter(o, key, model, t);
    } catch (err) {
      if (isCapacityError(err)) cool(model, err);
      throw err;
    }
  };

  const main = mainModel();
  const backup = fallbackModel();
  let last: unknown;
  const failures: unknown[] = [];
  let triedMain = false;
  if (!isCooling(main)) {
    triedMain = true;
    try {
      return await attempt(main);
    } catch (first) {
      if (!isCapacityError(first)) throw first;
      last = first;
      failures.push(first);
    }
  }

  const alternatives = backup && backup !== main && !isCooling(backup) ? [backup] : [];
  for (const model of alternatives) {
    try {
      return await attempt(model);
    } catch (err) {
      last = err;
      failures.push(err);
      if (!isCapacityError(err)) throw err;
    }
  }

  // Everything is resting: ask the main model anyway rather than fail without trying.
  if (!triedMain && alternatives.length === 0) return attempt(main);
  // A retired model (404) says nothing about whether the service is busy. If anything else
  // failed too (quota, overload, timeout), report that one instead of the 404.
  const informative = failures.find((e) => statusOf(e) !== 404);
  throw informative ?? last ?? new Error("The AI service is busy right now. Wait a few seconds and try again.");
}

/** Auth and bad-request errors won't fix themselves; everything else might. */
function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (typeof status === "number") return status === 408 || status === 409 || status === 429 || status >= 500;
  return true; // network error, timeout, malformed output
}

/** Asks the model for JSON in the given shape. */
export async function generateJson(o: GenerateOptions): Promise<Record<string, unknown>> {
  return (await generateJsonWithMeta(o)).data;
}

/** Wait between retries. Tests set LLM_BACKOFF_MS=0 so they don't sit through the delay. */
const backoffMs = () => Number(process.env.LLM_BACKOFF_MS ?? 1000);

/** Same as generateJson, and also reports which model answered, how many calls it took and how long. */
export async function generateJsonWithMeta(
  o: GenerateOptions,
): Promise<{ data: Record<string, unknown>; meta: CallMeta }> {
  const key = apiKey();
  if (!key) throw new Error(NO_KEY_MESSAGE);

  let last: unknown;
  const startedAt = Date.now();
  const trace: Trace = { model: "", calls: 0, deadline: startedAt + TOTAL_BUDGET_MS };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      trace.calls++;
      let out = await viaOpenRouterWithFallback(o, key, trace);
      // Some models answer with the bare list of items instead of {"items": [...]}.
      // The list is wrapped here; every item still goes through the normal safety checks.
      if (Array.isArray(out) && o.arrayKey) out = { [o.arrayKey]: out };
      if (!out || typeof out !== "object" || Array.isArray(out)) {
        throw new Error("The AI returned data in the wrong shape.");
      }
      return {
        data: out as Record<string, unknown>,
        meta: {
          provider: "openrouter",
          model: trace.model,
          calls: trace.calls,
          ms: Date.now() - startedAt,
          fellBack: trace.model !== mainModel(),
        },
      };
    } catch (err) {
      last = err;
      if (attempt === MAX_ATTEMPTS || !isRetryable(err)) break;
      if (Date.now() - startedAt > RETRY_BUDGET_MS) break;
      await new Promise((r) => setTimeout(r, backoffMs() * attempt));
    }
  }
  if (isTimeout(last)) {
    throw new Error("The AI took too long to answer. Try again in a moment.");
  }
  throw last instanceof Error ? last : new Error("The AI request failed.");
}

/** A request that ran out of time (the browser and Node word this differently). */
function isTimeout(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === "TimeoutError" || e?.name === "AbortError" || /aborted due to timeout|timed? ?out/i.test(e?.message ?? "");
}
