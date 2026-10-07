import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 2026-10-07: the server stores the photo itself and refuses a link or a storage key as evidence
 * (EVIDENCE_MEDIA_INVALID). The proof panel used to offer a "paste a URL" box; a pasted link would
 * now only ever be refused, and it was never a photo of the job.
 */
const panel = readFileSync(join(import.meta.dir, "..", "src", "components", "requests", "JobEvidencePanel.tsx"), "utf8");
const steps = readFileSync(join(import.meta.dir, "..", "src", "components", "requests", "ExecutionSteps.tsx"), "utf8");

describe("job evidence is a photo from the device", () => {
  test("the proof panel has no way to submit a link", () => {
    expect(panel).not.toMatch(/Upload URL|paste data URL|urlDraft|https:\/\/…/);
    expect(panel).toContain('type="file"');
    expect(panel).toContain("fileToDataUrl");
  });

  test("step photos are sent as the image read from the file, never as a link", () => {
    expect(steps).toContain("mediaUrl: await fileToDataUrl(file)");
    expect(steps).not.toMatch(/mediaStorageKey/);
  });
});
