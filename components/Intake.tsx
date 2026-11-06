"use client";

import { useRef, useState } from "react";
import { apiJson, isHandledApiError } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import { SAMPLE_INJECTION_TEXT, SAMPLE_SYLLABUS_TEXT } from "@/lib/sample";
import type { CourseItem, ExtractResponse, ReadMeta } from "@/lib/types";

interface Props {
  onExtracted: (items: CourseItem[], warnings: string[], replace: boolean, meta?: ReadMeta) => void;
  onLoadSample: () => void;
  hasItems: boolean;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function Intake({ onExtracted, onLoadSample, hasItems }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [replace, setReplace] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  async function extract() {
    if (file && file.size > MAX_FILE_BYTES) {
      setError("File is larger than 10 MB. Paste the assessment section instead.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (file) form.set("file", file);
      if (text.trim()) form.set("text", text);
      form.set("today", todayISO());
      const data = await apiJson<ExtractResponse>("/api/extract", { method: "POST", body: form }, "Extraction failed.");
      if (data.items.length === 0) {
        // Nothing usable came back: say so, keep what the student already has, and keep their text.
        const extra = (data.warnings ?? []).filter((w) => !/no dated items/i.test(w));
        setError(
          ["No deadlines were found. Paste the part of the syllabus that lists assessments with dates.", ...extra].join(" "),
        );
        return;
      }
      onExtracted(data.items, data.warnings, hasItems && replace, data.meta);
      setFile(null);
      setText("");
    } catch (e) {
      // 429 / 503 are already shown as a modal by lib/api.ts.
      if (isHandledApiError(e)) return;
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="intake">
        {!hasItems && (
          <p className="firstrun">
            Drop a PDF, or paste the assessment section of your syllabus. No syllabus handy? Try a sample
            semester: it works without the AI.
          </p>
        )}
        <div
          className={`drop${over ? " over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
        >
          <strong>{file ? file.name : "Drop a syllabus here"}</strong>
          <small>
            {file
              ? `${(file.size / 1024).toFixed(0)} KB. Click to choose a different file.`
              : "PDF or image, up to 10 MB"}
          </small>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <textarea
          aria-label="Syllabus text"
          placeholder="Or paste the text here"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="intake-actions">
          <button
            className="btn primary"
            onClick={extract}
            disabled={busy || (!file && !text.trim())}
          >
            {busy ? "Reading your syllabus…" : "Extract deadlines"}
          </button>
          <button className="btn ghost small" onClick={() => setText(SAMPLE_SYLLABUS_TEXT)} disabled={busy}>
            Fill in sample text
          </button>
          <button className="btn ghost small" onClick={() => setText(SAMPLE_INJECTION_TEXT)} disabled={busy}>
            Fill in injection test
          </button>
          <span className="spacer" />
          {!hasItems && (
            <button className="btn mark" onClick={onLoadSample} disabled={busy}>
              Try a sample semester
            </button>
          )}
        </div>
        {hasItems && (
          <label className="replace">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>
              Replace what's here. Untick to add another course.
            </span>
          </label>
        )}
        <p className="privacy">
          Sent to an AI service to be read, not stored on a server. Your plan stays in this browser.
        </p>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
          {!hasItems && " You can also try the sample semester, which works without the AI."}
        </div>
      )}
    </div>
  );
}
