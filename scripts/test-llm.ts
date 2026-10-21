process.env.OPENROUTER_API_KEY = "test-key-test-key-test-key-1234";
process.env.OPENROUTER_MODEL = "google/gemini-2.5-flash";
process.env.OPENROUTER_FALLBACK_MODEL = "google/gemini-2.5-flash-lite";
process.env.LLM_BACKOFF_MS = "0";

import assert from "node:assert/strict";

/**
 * Reliability tests: the AI client is run against a pretend OpenRouter that is
 * busy, retired, slow, confused or rejecting the key, and we check what the
 * student would get each time. No real AI calls are made.
 */

const MAIN = "google/gemini-2.5-flash";
const BACKUP = "google/gemini-2.5-flash-lite";

const OPTS = {
  instructions: "Extract.",
  textParts: ["<syllabus>x</syllabus>"],
  toolName: "t",
  toolDescription: "t",
  schema: { type: "object" as const, properties: {} },
  shapeHint: "{}",
};

const text = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: t } }] }), { status: 200 });
const ok = (data: unknown) => text(JSON.stringify(data));
const status = (n: number, body = "boom") => new Response(body, { status: n });

interface Sent {
  model: string;
  body: Record<string, unknown>;
}
let sent: Sent[] = [];
let generateCalls: string[] = [];
function pretend(handler: (model: string, n: number, body: Record<string, unknown>) => Response | Promise<Response>) {
  sent = [];
  generateCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(String(input).startsWith("https://openrouter.ai/api/v1/chat/completions"));
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const model = String(body.model);
    sent.push({ model, body });
    generateCalls.push(model);
    return handler(model, generateCalls.length, body);
  }) as typeof fetch;
}

async function main() {
  const { generateJsonWithMeta, resetModelCache } = await import("../lib/llm");
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    resetModelCache();
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  };

  console.log("AI client reliability");

  await test("a normal answer comes back with the model name and one call", async () => {
    pretend(() => ok({ a: 1 }));
    const { data, meta } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 1 });
    assert.equal(meta.provider, "openrouter");
    assert.equal(meta.model, MAIN);
    assert.equal(meta.calls, 1);
    assert.equal(meta.fellBack, false);
  });

  await test("the request asks for structured JSON output", async () => {
    pretend(() => ok({ a: 1 }));
    await generateJsonWithMeta(OPTS);
    const rf = sent[0].body.response_format as { type: string; json_schema?: { schema: unknown } };
    assert.equal(rf.type, "json_schema");
    assert.deepEqual(rf.json_schema?.schema, OPTS.schema);
  });

  await test("an image is sent as an image_url data URI", async () => {
    pretend(() => ok({ a: 1 }));
    await generateJsonWithMeta({ ...OPTS, file: { mime: "image/png", data: "AAAA" } });
    const content = (sent[0].body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    assert.deepEqual(content[0], { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });

  await test("a scanned PDF is sent as an OpenRouter file part", async () => {
    pretend(() => ok({ a: 1 }));
    await generateJsonWithMeta({ ...OPTS, file: { mime: "application/pdf", data: "JVBE" } });
    const content = (sent[0].body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    assert.deepEqual(content[0], {
      type: "file",
      file: { filename: "syllabus.pdf", file_data: "data:application/pdf;base64,JVBE" },
    });
  });

  await test("when the main model is busy (503), the backup model answers", async () => {
    pretend((model) => (model === MAIN ? status(503) : ok({ a: 2 })));
    const { data, meta } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 2 });
    assert.equal(meta.model, BACKUP);
    assert.equal(meta.fellBack, true);
  });

  await test("when the main model has been retired (400 not a valid model), the backup answers", async () => {
    pretend((model) => (model === MAIN ? status(400, `{"error":{"message":"${MAIN} is not a valid model ID"}}`) : ok({ a: 3 })));
    const { meta } = await generateJsonWithMeta(OPTS);
    assert.equal(meta.model, BACKUP);
    assert.equal(meta.fellBack, true);
  });

  await test("when the main model stops answering (timeout), the backup answers", async () => {
    pretend((model) => {
      if (model === MAIN) {
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      }
      return ok({ a: 4 });
    });
    const { data, meta } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 4 });
    assert.equal(meta.model, BACKUP);
    assert.equal(meta.fellBack, true);
  });

  await test("if every attempt times out, the student gets a plain message", async () => {
    pretend(() => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await assert.rejects(
      () => generateJsonWithMeta(OPTS),
      (e: Error) => /took too long/i.test(e.message) && !/aborted/i.test(e.message),
    );
  });

  await test("a model that rejects the reasoning or schema setting is retried with a plain request", async () => {
    pretend((_m, n) =>
      n === 1 ? status(400, '{"error":{"message":"reasoning is not supported"}}') : ok({ a: 7 }),
    );
    const { data, meta } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 7 });
    assert.equal(meta.model, MAIN);
    assert.equal(generateCalls.length, 2);
    assert.equal((sent[1].body.response_format as { type: string }).type, "json_object");
    assert.equal(sent[1].body.reasoning, undefined);
  });

  await test("a model that is rate limited (429) is skipped on the next request", async () => {
    pretend((model) => (model === MAIN ? status(429) : ok({ a: 8 })));
    await generateJsonWithMeta(OPTS);
    assert.equal(generateCalls[0], MAIN);
    generateCalls = [];
    await generateJsonWithMeta(OPTS);
    assert.ok(generateCalls.length > 0 && !generateCalls.includes(MAIN));
  });

  await test("a reply that isn't valid JSON is retried", async () => {
    pretend((_m, n) => (n === 1 ? text("Sure! Here you go: {oops") : ok({ a: 5 })));
    const { data, meta } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 5 });
    assert.equal(meta.calls, 2);
  });

  await test("JSON wrapped in a code fence is still read", async () => {
    pretend(() => text('```json\n{"a": 6}\n```'));
    const { data } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 6 });
  });

  await test("a rejected key fails straight away with a clear message and no retries", async () => {
    pretend(() => status(401));
    await assert.rejects(generateJsonWithMeta(OPTS), /key was rejected/i);
    assert.equal(generateCalls.length, 1);
  });

  await test("an error inside a 200 response is treated like the matching HTTP error", async () => {
    pretend((_m, n) =>
      n === 1
        ? new Response(JSON.stringify({ error: { code: 502, message: "upstream" } }), { status: 200 })
        : ok({ a: 9 }),
    );
    const { data } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 9 });
  });

  await test("when the main model is rate limited and the backup is retired, the student is told it is busy", async () => {
    pretend((model) => (model === BACKUP ? status(404) : status(429)));
    await assert.rejects(
      generateJsonWithMeta(OPTS),
      (e: Error) => /busy right now/i.test(e.message) && !/no longer available/i.test(e.message),
    );
  });

  await test("a retired model is not asked again on the next request", async () => {
    pretend((model) => (model === MAIN ? status(404) : ok({ a: 1 })));
    await generateJsonWithMeta(OPTS);
    pretend(() => ok({ a: 2 }));
    await generateJsonWithMeta(OPTS);
    assert.ok(!generateCalls.includes(MAIN), `asked: ${generateCalls.join(", ")}`);
  });

  await test("when every model is busy, it gives up after a few tries with a friendly message", async () => {
    pretend(() => status(503));
    await assert.rejects(generateJsonWithMeta(OPTS), /busy right now/i);
    assert.ok(generateCalls.length <= 12, `made ${generateCalls.length} calls`);
  });

  await test("an answer of the wrong shape (a list) is refused", async () => {
    pretend(() => ok([1, 2, 3]));
    await assert.rejects(generateJsonWithMeta(OPTS), /wrong shape/i);
  });

  await test("a bare list is wrapped when the caller names a key for it", async () => {
    pretend(() => ok([{ title: "Essay" }]));
    const { data } = await generateJsonWithMeta({ ...OPTS, arrayKey: "items" });
    assert.deepEqual(data, { items: [{ title: "Essay" }] });
  });

  await test("an empty reply is retried, not accepted", async () => {
    pretend((_m, n) => (n === 1 ? new Response(JSON.stringify({ choices: [] }), { status: 200 }) : ok({ a: 7 })));
    const { data } = await generateJsonWithMeta(OPTS);
    assert.deepEqual(data, { a: 7 });
  });

  console.log(`\nAll ${passed} AI client tests passed.`);
}
main();
