/**
 * Times a tiny JSON request on the configured OpenRouter models (OPENROUTER_MODEL
 * and OPENROUTER_FALLBACK_MODEL, plus any model ids passed as arguments), so you
 * can see which ones are fast right now and pick OPENROUTER_MODEL accordingly.
 *
 *   npm run ping
 *   npm run ping -- google/gemini-3.6-flash openai/gpt-4o-mini
 *
 * It never prints your key.
 */
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.log("No OPENROUTER_API_KEY found in .env.");
  process.exit(1);
}

const ENDPOINT = "https://api.apiyi.com/v1/chat/completions";

async function time(model: string, jsonSchema: boolean): Promise<string> {
  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 50,
        messages: [{ role: "user", content: 'Reply with JSON only: {"ok": true}' }],
        response_format: jsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: "ping",
                strict: false,
                schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
              },
            }
          : { type: "json_object" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const s = ((Date.now() - started) / 1000).toFixed(1);
    if (res.ok) return `${s}s ok`;
    const body = (await res.text()).slice(0, 80).replace(/\s+/g, " ");
    return `${s}s HTTP ${res.status} ${body}`;
  } catch (e) {
    const s = ((Date.now() - started) / 1000).toFixed(1);
    return `${s}s ${(e as Error).name === "TimeoutError" ? "TIMED OUT" : (e as Error).message}`;
  }
}

(async () => {
  const models = [
    process.env.OPENROUTER_MODEL || "gemini-3.5-flash-lite",
    process.env.OPENROUTER_FALLBACK_MODEL || "gemini-3.1-flash-lite",
    ...process.argv.slice(2),
  ].filter((m, i, all) => all.indexOf(m) === i);
  console.log(`Timing ${models.length} models with a tiny request (25s limit each)...\n`);
  for (const m of models) {
    const schema = await time(m, true);
    const plain = await time(m, false);
    console.log(`${m}\n   json_schema: ${schema}\n   json_object: ${plain}`);
  }
  console.log("\nSet OPENROUTER_MODEL in .env to the fastest model that says ok, then restart the server.");
})();
