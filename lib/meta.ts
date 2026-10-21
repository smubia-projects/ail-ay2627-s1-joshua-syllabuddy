import type { ReadMeta } from "./types";

/** "google/gemini-2.5-flash" -> "Gemini 2.5 Flash" */
export function prettyModel(model: string): string {
  return model
    .replace(/^[^/]*\//, "")
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

/** One plain line about how the AI read the syllabus, shown under the table. */
export function describeRead(m: ReadMeta): string {
  const parts = [`Read by ${prettyModel(m.model)} in ${(m.ms / 1000).toFixed(1)}s`];
  if (m.source === "pdf-text") parts.push("text taken from the PDF");
  if (m.source === "file") parts.push("read from the file itself, so dates can't be checked against text");
  if (m.fellBack) parts.push("the first-choice model was busy, so a backup answered");
  const retries = m.calls - 1 - (m.repair ? 1 : 0);
  if (retries > 0) parts.push(`${retries} retr${retries === 1 ? "y" : "ies"}`);
  if (m.repair) {
    const r = m.repair;
    parts.push(
      `${r.attempted} flagged item${r.attempted === 1 ? "" : "s"} re-read: ${r.fixed} fixed, ${r.removed} removed, ${r.stillFlagged} left for you`,
    );
  }
  return parts.join(" · ");
}
