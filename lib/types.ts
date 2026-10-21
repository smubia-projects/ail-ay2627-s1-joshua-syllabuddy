export type ItemType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "reading"
  | "other";

export const ITEM_TYPES: ItemType[] = [
  "assignment",
  "exam",
  "quiz",
  "project",
  "reading",
  "other",
];

export interface CourseItem {
  id: string;
  course: string;
  title: string;
  type: ItemType;
  /** ISO date, YYYY-MM-DD */
  dueDate: string;
  /** Share of the final grade, 0-100. 0 if unknown/ungraded. */
  weightPct: number;
  /** Optional manual override of estimated effort in hours. */
  estHours?: number | null;
  done?: boolean;
  /** Extraction note, e.g. "date assumed" - shown in the review table. */
  note?: string;
  /** Line from the syllabus that the AI says this item came from. */
  evidence?: string;
  /** Reasons the safety checks want a human to look at this item. */
  verify?: string[];
  /** True when the item came from the AI (not typed in or from the sample). */
  fromAi?: boolean;
  /** The quoted line exists in the pasted syllabus and agrees with the date. */
  verified?: boolean;
  /** The student checked this item themselves. */
  confirmed?: boolean;
}

export interface StudyBlock {
  id: string;
  itemId: string;
  course: string;
  title: string;
  /** ISO date */
  date: string;
  hours: number;
  kind: "work" | "review";
}

export type WeekLoad = "light" | "normal" | "crunch";

export interface WeekSummary {
  /** ISO date of the Monday */
  weekStart: string;
  scheduledHours: number;
  capacityHours: number;
  dueItems: CourseItem[];
  weightDue: number;
  load: WeekLoad;
  reasons: string[];
}

/** A stretch of days with less (or no) study time, e.g. illness or a trip. */
export interface Availability {
  id: string;
  /** ISO dates, inclusive */
  startDate: string;
  endDate: string;
  /** Most study hours per day in this range. 0 = unavailable. */
  hoursPerDay: number;
}

/**
 * The only changes the AI is allowed to propose. Each one is validated by code,
 * shown to the student in plain words, and applied only after they approve it.
 */
export type Adjustment =
  | { kind: "availability"; startDate: string; endDate: string; hoursPerDay: number }
  | { kind: "mark_done"; itemId: string }
  | { kind: "move_deadline"; itemId: string; newDate: string }
  | { kind: "set_hours"; itemId: string; hours: number };

export interface PlanOptions {
  startDate?: string;
  weekdayHours?: number;
  weekendHours?: number;
  availability?: Availability[];
}

export interface Plan {
  startDate: string;
  blocks: StudyBlock[];
  weeks: WeekSummary[];
  warnings: string[];
  totalHours: number;
}

/** What happened when the AI was called, shown to the student under the table. */
export interface ReadMeta {
  provider: "openrouter";
  model: string;
  /** Total AI calls made, counting retries and the repair call. */
  calls: number;
  /** Time spent waiting for the AI, in milliseconds. */
  ms: number;
  /** True when the first-choice model wasn't the one that answered. */
  fellBack: boolean;
  /** How the text was read: pasted text, a PDF's text layer, or the file itself. */
  source?: "text" | "pdf-text" | "file";
  repair?: RepairReport;
}

/** Result of the check-and-repair step. */
export interface RepairReport {
  /** Items the checks flagged as wrong or unsupported and sent back to the AI. */
  attempted: number;
  /** Items whose problems were gone after the AI re-read the syllabus. */
  fixed: number;
  /** Items the AI said aren't in the syllabus, so they were dropped. */
  removed: number;
  /** Items still flagged after repair, left for the student. */
  stillFlagged: number;
}

export interface ExtractResponse {
  items: CourseItem[];
  warnings: string[];
  meta?: ReadMeta;
}
