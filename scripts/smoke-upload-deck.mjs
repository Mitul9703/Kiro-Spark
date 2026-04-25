// Smoke test for POST /api/upload-deck.
// The dev server must be running (npm run dev) before invoking this script.
// Usage: node scripts/smoke-upload-deck.mjs
// Override target via SPARK_HTTP_URL=http://host:port
//
// Two-mode strategy: if scripts/fixtures/sample.pdf exists, use it (happy path).
// Otherwise, hit the endpoint with no file to verify the route is mounted and
// the multer-driven 400 path works. Either path proves the endpoint is live.

import fs from "node:fs";
import path from "node:path";

const url = process.env.SPARK_HTTP_URL ?? "http://localhost:3000";
const fixtureDir = path.resolve("scripts/fixtures");
const fixturePath = path.join(fixtureDir, "sample.pdf");

if (fs.existsSync(fixturePath)) {
  // Happy path: real PDF upload.
  const blob = new Blob([fs.readFileSync(fixturePath)], { type: "application/pdf" });
  const form = new FormData();
  form.append("deck", blob, "sample.pdf");
  const res = await fetch(`${url}/api/upload-deck`, { method: "POST", body: form });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  const json = await res.json();
  if (!json.ok) {
    console.error("not ok", json);
    process.exit(1);
  }
  if (typeof json.contextText !== "string") {
    console.error("missing contextText", json);
    process.exit(1);
  }
  if (typeof json.contextPreview !== "string") {
    console.error("missing contextPreview", json);
    process.exit(1);
  }
  console.log(
    "OK fileName=%s contextText.length=%d",
    json.fileName ?? "(unset)",
    json.contextText.length,
  );
} else {
  // No-file path: verify the route is mounted and rejects with a 400.
  const res = await fetch(`${url}/api/upload-deck`, { method: "POST" });
  if (res.status !== 400) {
    console.error("expected 400 (no file) got", res.status, await res.text());
    process.exit(1);
  }
  const json = await res.json().catch(() => ({}));
  console.log(
    "OK no-fixture mode: route mounted, 400 on missing file (%s)",
    json.error ?? "(no error key)",
  );
  console.log("hint: drop a real PDF at scripts/fixtures/sample.pdf to exercise the happy path.");
}
