import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { limitAdjust, limitExtract } from "./rateLimit";
import { adjustHandler } from "./routes/adjust";
import { extractHandler, MAX_FILE_BYTES } from "./routes/extract";

/**
 * Syllabuddy API (Cloud Run). API-only: the Next.js frontend is deployed
 * separately on Vercel and calls these routes via NEXT_PUBLIC_API_BASE.
 *
 *   GET  /api/health   -> {"status":"ok"}
 *   POST /api/extract  -> read a syllabus (multipart: file and/or text)   [rate limited: extract]
 *   POST /api/adjust   -> turn a plain-English change into plan changes   [rate limited: adjust]
 */

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    // No CORS_ORIGINS set (local dev) -> allow any origin. Otherwise only the listed ones.
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)),
  }),
);

// The app's own caps (10 MB file, 60k chars of text) sit well under Cloud Run's 32 MB request limit.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10, fieldSize: 1024 * 1024 },
});
const json = express.json({ limit: "1mb" });

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/extract", upload.single("file"), limitExtract, extractHandler);
app.post("/api/adjust", json, limitAdjust, adjustHandler);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found. This is the Syllabuddy API; the app itself is on the frontend." });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? "File is larger than 10 MB." : err.message });
  }
  const status = Number((err as { status?: number }).status) || 500;
  if (status === 413) return res.status(413).json({ error: "That request is too large." });
  if (status === 400) return res.status(400).json({ error: "Expected JSON." });
  console.error(err);
  return res.status(500).json({ error: "Something went wrong on the server." });
};
app.use(onError);

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`Syllabuddy API listening on 0.0.0.0:${port}`);
});
