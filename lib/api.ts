/**
 * The one way the browser talks to the Syllabuddy API.
 *
 * The API runs on Cloud Run and the frontend on Vercel, so every request is
 * prefixed with NEXT_PUBLIC_API_BASE (inlined at build time). Locally it
 * defaults to the Express dev server on port 8080 (`npm run dev:server`).
 *
 * The shared rate-limit engine's responses are handled here, once:
 *  - 429 (limit reached)  -> dispatches RATE_LIMIT_EVENT with queries_used, for the CTA modal
 *  - 503 (demo paused)    -> dispatches DEMO_PAUSED_EVENT with the message, for the paused notice
 * Both throw a HandledApiError, which callers ignore instead of showing an error.
 */

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080").replace(/\/+$/, "");

export const RATE_LIMIT_EVENT = "syllabuddy:rate-limit";
export const DEMO_PAUSED_EVENT = "syllabuddy:demo-paused";

/** Thrown after a 429 or 503 has already been shown to the student in a modal. */
export class HandledApiError extends Error {
  constructor(public status: number) {
    super(status === 429 ? "Rate limit reached." : "Demo paused.");
  }
}

export const isHandledApiError = (e: unknown): e is HandledApiError => e instanceof HandledApiError;

/** POSTs to the API and returns the parsed JSON, or throws an Error with a readable message. */
export async function apiJson<T>(path: string, init: RequestInit, fallbackError: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error("Couldn't reach the Syllabuddy server. Check your connection and try again.");
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (res.status === 429) {
    const detail = (body?.detail ?? {}) as Record<string, unknown>;
    const queriesUsed = Number(body?.queries_used ?? detail.queries_used ?? 0) || 0;
    window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { queriesUsed } }));
    throw new HandledApiError(429);
  }
  if (res.status === 503) {
    const detail = (body?.detail ?? {}) as Record<string, unknown>;
    const message = String(body?.message ?? detail.message ?? "");
    window.dispatchEvent(new CustomEvent(DEMO_PAUSED_EVENT, { detail: { message } }));
    throw new HandledApiError(503);
  }
  if (!res.ok || !body) {
    throw new Error(typeof body?.error === "string" ? body.error : fallbackError);
  }
  return body as T;
}
