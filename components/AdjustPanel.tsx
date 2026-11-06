"use client";

import { useState } from "react";
import { describeAdjustment, describeAvailability } from "@/lib/adjust";
import { apiJson, isHandledApiError } from "@/lib/api";
import { todayISO } from "@/lib/dates";
import type { Adjustment, Availability, CourseItem } from "@/lib/types";

interface Props {
  items: CourseItem[];
  availability: Availability[];
  onApply: (adjustments: Adjustment[]) => void;
  onRemoveAvailability: (id: string) => void;
}

interface Proposal {
  adjustments: Adjustment[];
  unclear?: string;
  warnings: string[];
}

const EXAMPLES = [
  "I'm sick from Thursday to Sunday",
  "I can only study 1 hour a day next week",
  "I've finished the first reading",
];

export default function AdjustPanel({ items, availability, onApply, onRemoveAvailability }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  async function suggest() {
    setBusy(true);
    setError(null);
    setProposal(null);
    try {
      const data = await apiJson<Proposal>(
        "/api/adjust",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request: text,
            today: todayISO(),
            items: items.map((i) => ({
              id: i.id,
              course: i.course,
              title: i.title,
              type: i.type,
              dueDate: i.dueDate,
              done: !!i.done,
            })),
          }),
        },
        "Something went wrong.",
      );
      setProposal(data);
    } catch (e) {
      // 429 / 503 are already shown as a modal by lib/api.ts.
      if (isHandledApiError(e)) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card adjust">
      <h3>Something changed?</h3>
      <p className="hint-line">
        Say what changed. Nothing is applied until you approve it.
      </p>

      <div className="adjust-row">
        <textarea
          aria-label="What changed"
          rows={2}
          maxLength={500}
          placeholder="e.g. I'm sick from Thursday to Sunday"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" onClick={suggest} disabled={busy || !text.trim()}>
          {busy ? "Thinking…" : "Suggest changes"}
        </button>
      </div>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="btn ghost small" onClick={() => setText(ex)} disabled={busy}>
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {proposal && (
        <div className="proposal" role="region" aria-label="Suggested changes">
          {proposal.adjustments.length > 0 ? (
            <>
              <b>Suggested changes:</b>
              <ul>
                {proposal.adjustments.map((a, i) => (
                  <li key={i}>{describeAdjustment(a, items)}</li>
                ))}
              </ul>
              <div className="table-foot">
                <button
                  className="btn mark"
                  onClick={() => {
                    onApply(proposal.adjustments);
                    setProposal(null);
                    setText("");
                  }}
                >
                  Apply and re-plan
                </button>
                <button className="btn ghost" onClick={() => setProposal(null)}>
                  Discard
                </button>
              </div>
            </>
          ) : (
            <b>No changes suggested.</b>
          )}
          {proposal.unclear && <p className="note-line">{proposal.unclear}</p>}
          {proposal.warnings.map((w) => (
            <p key={w} className="note-line">
              {w}
            </p>
          ))}
        </div>
      )}

      {availability.length > 0 && (
        <div className="active-changes">
          <b>Active time changes</b>
          <ul>
            {availability.map((a) => (
              <li key={a.id}>
                {describeAvailability(a)}
                <button className="linkish" onClick={() => onRemoveAvailability(a.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
