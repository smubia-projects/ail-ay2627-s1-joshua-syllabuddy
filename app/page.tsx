"use client";

import { useEffect, useMemo, useState } from "react";
import Dashboard from "@/components/Dashboard";
import AdjustPanel from "@/components/AdjustPanel";
import Intake from "@/components/Intake";
import PlanView, { type PlanSettings } from "@/components/PlanView";
import ReviewTable from "@/components/ReviewTable";
import { ApiNotices } from "@/components/RateLimitCTA";
import { courseColors } from "@/lib/colors";
import { isValidISO, todayISO } from "@/lib/dates";
import { generatePlan } from "@/lib/planner";
import { applyAdjustments } from "@/lib/adjust";
import { checkWeights } from "@/lib/safety";
import { sampleItemsFrom } from "@/lib/sample";
import { describeRead } from "@/lib/meta";
import type { CourseItem, ReadMeta } from "@/lib/types";

const STORE_KEY = "ail-ay2627-s1-joshua-syllabuddy:plan:v1";
const DEFAULT_SETTINGS: PlanSettings = {
  startDate: "",
  weekdayHours: 3,
  weekendHours: 4,
  availability: [],
};

export default function Home() {
  const [items, setItems] = useState<CourseItem[]>([]);
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [extractWarnings, setExtractWarnings] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [readMeta, setReadMeta] = useState<ReadMeta | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Restore the last session so a refresh doesn't lose the semester.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        if (parsed.readMeta) setReadMeta(parsed.readMeta);
      }
    } catch {
      /* storage unavailable: start fresh */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ items, settings, readMeta }));
    } catch {
      /* ignore */
    }
  }, [items, settings, readMeta, ready]);

  const colors = useMemo(() => courseColors(items), [items]);
  const datedItems = useMemo(() => items.filter((i) => isValidISO(i.dueDate)), [items]);
  const skipped = items.filter((i) => !i.done && !isValidISO(i.dueDate)).length;
  const allWarnings = useMemo(
    () => [...extractWarnings, ...checkWeights(items)],
    [extractWarnings, items],
  );

  const needsCheck = items.filter((i) => !i.done && (i.verify?.length ?? 0) > 0 && !i.confirmed).length;

  const plan = useMemo(
    () =>
      generatePlan(datedItems, {
        startDate: settings.startDate || todayISO(),
        weekdayHours: settings.weekdayHours,
        weekendHours: settings.weekendHours,
        availability: settings.availability,
      }),
    [datedItems, settings],
  );

  return (
    <main className="wrap">
      <header className={`masthead${items.length > 0 ? " compact" : ""}`}>
        <div className="brand">Syllabuddy</div>
        <h1>
          Your semester, <span>planned.</span>
        </h1>
        {items.length === 0 && (
          <p>
            Drop in your syllabi. Get one plan that shows the crunch weeks before they hit.
          </p>
        )}
      </header>

      {items.length > 0 && (
        <Dashboard
          items={datedItems}
          plan={plan}
          colors={colors}
          onDone={(id) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: true } : i)))}
        />
      )}

      <section className="step" aria-labelledby="s1">
        <div className="step-head">
          <span className="n">1</span>
          <h2 id="s1">{items.length > 0 ? "Syllabi" : "Add a syllabus"}</h2>
          {items.length > 0 && (
            <span className="hint">
              {items.length} items · {Object.keys(colors).length} course{Object.keys(colors).length === 1 ? "" : "s"}
            </span>
          )}
          {items.length > 0 && (
            <button className="btn ghost small" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
              {addOpen ? "Hide" : "Add or replace a syllabus"}
            </button>
          )}
        </div>
        {(items.length === 0 || addOpen) && (
          <Intake
            hasItems={items.length > 0}
            onLoadSample={() => {
              setItems(sampleItemsFrom(todayISO()));
              setExtractWarnings([]);
            }}
            onExtracted={(added, warnings, replace, meta) => {
              if (meta) setReadMeta(meta);
              if (replace) setSettings((s) => ({ ...s, availability: [] }));
              setItems((prev) => (replace ? added : [...prev, ...added]));
              setExtractWarnings(warnings);
              setReviewOpen(true);
              setAddOpen(false);
            }}
          />
        )}
      </section>

      {items.length > 0 && (
        <>
          <section className="step" aria-labelledby="s2">
            <div className="step-head">
              <span className="n">2</span>
              <h2 id="s2">Check the deadlines</h2>
              <span className="hint">
                {needsCheck > 0
                  ? `${needsCheck} to check`
                  : allWarnings.length > 0
                    ? "Read the warnings below"
                    : "Everything looks right"}
              </span>
              <button className="btn ghost small" onClick={() => setReviewOpen((o) => !o)} aria-expanded={reviewOpen}>
                {reviewOpen ? "Hide" : "Review and edit"}
              </button>
            </div>
            {allWarnings.length > 0 && (
              <div className="alert soft" style={{ marginBottom: 12 }}>
                <ul>
                  {allWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {readMeta && <p className="readmeta">{describeRead(readMeta)}</p>}
            {reviewOpen && <ReviewTable items={items} colors={colors} onChange={setItems} />}
          </section>

          <section className="step" aria-labelledby="s3">
            <div className="step-head">
              <span className="n">3</span>
              <h2 id="s3">Your plan</h2>
            </div>
            <AdjustPanel
              items={datedItems}
              availability={settings.availability}
              onApply={(adjustments) => {
                const next = applyAdjustments(adjustments, items, settings.availability);
                setItems(next.items);
                setSettings({ ...settings, availability: next.availability });
              }}
              onRemoveAvailability={(id) =>
                setSettings({
                  ...settings,
                  availability: settings.availability.filter((a) => a.id !== id),
                })
              }
            />
            <PlanView
              plan={plan}
              items={datedItems}
              colors={colors}
              settings={settings}
              onSettings={setSettings}
              skipped={skipped}
            />
          </section>
        </>
      )}

      <p className="footer-note">
        Hours are estimates. Edit any item and the plan updates.
        <button
          className="linkish"
          onClick={() => {
            if (!confirm("Erase your items and settings from this browser?")) return;
            try {
              localStorage.removeItem(STORE_KEY);
            } catch {
              /* ignore */
            }
            setItems([]);
            setReadMeta(null);
            setSettings(DEFAULT_SETTINGS);
            setExtractWarnings([]);
          }}
        >
          Erase everything saved in this browser
        </button>
      </p>
      <ApiNotices />
    </main>
  );
}
