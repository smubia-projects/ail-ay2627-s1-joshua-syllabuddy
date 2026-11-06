import type { Request, Response } from "express";
import { hasApiKey, NO_KEY_MESSAGE } from "@/lib/llm";
import { hasUsableText, MAX_PDF_CHARS, readPdfText } from "@/lib/pdf-text";
import { runExtraction } from "@/lib/pipeline";

/** POST /api/extract — multipart form: optional `file` (PDF/image), optional `text`, `today`. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const fail = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });

export async function extractHandler(req: Request, res: Response) {
  if (!hasApiKey()) return fail(res, NO_KEY_MESSAGE, 500);

  const upload = req.file;
  const text = String(req.body?.text ?? "").trim();
  const today = String(req.body?.today ?? new Date().toISOString().slice(0, 10));

  if (text.length > MAX_TEXT_CHARS) {
    return fail(res, "That text is too long. Paste just the assessment and schedule sections.");
  }

  let file: { mime: string; data: string } | null = null;
  let sourceText = text;
  let pdfRead = false;
  const notes: string[] = [];
  if (upload && upload.size > 0) {
    if (upload.size > MAX_FILE_BYTES) return fail(res, "File is larger than 10 MB.", 413);
    if (upload.mimetype !== "application/pdf" && !IMAGE_TYPES.includes(upload.mimetype)) {
      return fail(res, "Upload a PDF or an image (PNG, JPG, WEBP), or paste the text.");
    }
    const bytes = new Uint8Array(upload.buffer);

    // A PDF with a real text layer is read as text. That lets every date be
    // checked against the document's own words, just like pasted text.
    let pdfText: string | null = null;
    if (upload.mimetype === "application/pdf") {
      const read = await readPdfText(bytes);
      if (read && hasUsableText(read.text)) {
        pdfText = read.text.trim();
        if (pdfText.length > MAX_PDF_CHARS) {
          pdfText = pdfText.slice(0, MAX_PDF_CHARS);
          notes.push("This PDF is very long, so only the first part was read. Add anything missing by pasting it.");
        }
      }
    }
    if (pdfText) {
      sourceText = text ? `${pdfText}\n\n${text}` : pdfText;
      pdfRead = true;
    } else {
      // Scanned PDF or image: no text to check against, so the model reads the file itself.
      file = { mime: upload.mimetype, data: upload.buffer.toString("base64") };
      if (upload.mimetype === "application/pdf") {
        notes.push("This PDF looks scanned, so its text couldn't be read directly. Compare the dates with your syllabus.");
      }
    }
  }
  if (!file && !sourceText) return fail(res, "Provide a syllabus file or paste its text.");

  // Read, check against the syllabus, and send anything that fails the checks back once.
  // Nothing the model returns is trusted: quotes can be verified against pasted text and PDF
  // text, but not against scans or images.
  let result;
  try {
    ({ result } = await runExtraction({
      text: sourceText,
      file,
      today,
      source: file ? "file" : pdfRead ? "pdf-text" : "text",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return fail(res, `Extraction failed: ${msg}`, 502);
  }
  result.warnings.push(...notes);
  return res.json(result);
}
