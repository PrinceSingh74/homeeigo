import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PartnerApiError } from "../src/lib/api-error";
import {
  CHAT_CLOSED_MESSAGE,
  isActiveJobStatus,
  isChatClosedError,
  isChatOpen,
  isOfferStatus,
  jobSubResourcesEnabled,
} from "../src/lib/job-stage";

/**
 * Two stage rules of the job page, 2026-10-06.
 *
 * OFFER: a partner who is only offered a job (status pending) does not hold it. The server answers
 * `/actions`, `/requirements`, `/execution`, `/safety`, `/quality`, `/completion` and `/evidence` with
 * 404 or an empty list by design, and the page rendered each as "could not be loaded". The brief an
 * offer needs is already in the booking payload.
 *
 * CHAT: the chat routes answer 403 `CHAT_CLOSED` once the job is no longer active. The panel went on
 * polling every 8 s, marking read, and offering a composer to a customer the partner no longer serves.
 */
const root = join(import.meta.dir, "..", "src");
const page = readFileSync(join(root, "app", "(partner)", "requests", "[id]", "page.tsx"), "utf8");
const chat = readFileSync(join(root, "components", "requests", "JobChatPanel.tsx"), "utf8");
const offerCard = readFileSync(join(root, "components", "requests", "JobOfferCard.tsx"), "utf8");

const ACTIVE = ["accepted", "assigned", "en_route", "in_progress"];
const NOT_ACTIVE = ["pending", "completed", "rejected", "cancelled", "cancelled_by_user", "cancelled_by_provider"];

describe("which statuses are an active job", () => {
  test("exactly accepted, assigned, en_route and in_progress", () => {
    expect(ACTIVE.filter((s) => !isActiveJobStatus(s))).toEqual([]);
    expect(NOT_ACTIVE.filter((s) => isActiveJobStatus(s))).toEqual([]);
  });

  test("an unknown or missing status is not active", () => {
    for (const s of [undefined, null, "", "ACCEPTED", "something_new"]) expect(isActiveJobStatus(s)).toBe(false);
  });

  test("only pending is an offer", () => {
    expect(isOfferStatus("pending")).toBe(true);
    for (const s of [...ACTIVE, "completed", "cancelled", undefined, null]) expect(isOfferStatus(s)).toBe(false);
  });
});

describe("sub-resource reads by stage", () => {
  const ALL = ["actions", "requirements", "execution", "safety", "quality", "completion", "evidence"] as const;

  test("an offer reads none of them", () => {
    const enabled = jobSubResourcesEnabled("pending");
    expect(ALL.filter((k) => enabled[k])).toEqual([]);
  });

  test("a job the partner holds, or held, reads all of them", () => {
    for (const s of [...ACTIVE, "completed", "cancelled_by_user"]) {
      const enabled = jobSubResourcesEnabled(s);
      expect({ s, off: ALL.filter((k) => !enabled[k]) }).toEqual({ s, off: [] });
    }
  });

  test("nothing is read before the status is known", () => {
    const enabled = jobSubResourcesEnabled(undefined);
    expect(ALL.filter((k) => enabled[k])).toEqual([]);
  });

  test("the job page gates its own reads on it", () => {
    expect(page).toContain("jobSubResourcesEnabled(");
    expect(page).toMatch(/queryFn: \(\) => partnerApi\.getJobActions\(id\),\s*enabled: [^,\n]*reads\.actions/);
    expect(page).toMatch(/useJobSafety\(id, [^)\n]*reads\.safety\)/);
    expect(page).toMatch(/useJobExecution\(id, [^)\n]*reads\.execution\)/);
    expect(page).toMatch(/useBookingRequirementsQuery\(id, [^)\n]*reads\.requirements\)/);
  });

  test("an offer is told when the rest opens, instead of load errors", () => {
    expect(page).toContain("isOfferStatus(");
    expect(page).toContain("open once the job is accepted");
  });
});

describe("the offer card states the scope and what to bring, and links to the job", () => {
  test("it renders the job selection and the requirements snapshot", () => {
    expect(offerCard).toContain("<JobBrief job={request.job}");
    expect(offerCard).toContain("offerBringList(request.requirements)");
  });

  test("it links to the job page", () => {
    expect(offerCard).toContain("href={`/requests/${request.id}`}");
    expect(offerCard).toContain("View details");
  });
});

describe("chat is open only while the job is active", () => {
  test("open for the four active statuses, closed for everything else", () => {
    expect(ACTIVE.filter((s) => !isChatOpen(s))).toEqual([]);
    expect([...NOT_ACTIVE, undefined, null].filter((s) => isChatOpen(s))).toEqual([]);
  });

  test("the server's CHAT_CLOSED refusal is recognised, other refusals are not", () => {
    expect(isChatClosedError(new PartnerApiError("Chat is not available", 403, "CHAT_CLOSED"))).toBe(true);
    expect(isChatClosedError(new PartnerApiError("Forbidden", 403, "FORBIDDEN"))).toBe(false);
    expect(isChatClosedError(new Error("CHAT_CLOSED"))).toBe(false);
    expect(isChatClosedError(null)).toBe(false);
  });

  test("the sentence the partner reads", () => {
    expect(CHAT_CLOSED_MESSAGE).toBe("Chat is closed for this job.");
  });

  test("the panel neither reads nor marks read when closed, and shows the sentence", () => {
    expect(chat).toContain("isChatOpen(status)");
    expect(chat).toMatch(/queryFn: \(\) => partnerApi\.listChat\(bookingId, \{ limit: 50 \}\),\s*enabled: open/);
    expect(chat).toMatch(/if \(!open\) return;\s*void partnerApi\.markChatRead/);
    expect(chat).toContain("CHAT_CLOSED_MESSAGE");
    expect(chat).toContain("isChatClosedError(");
  });

  test("the job page tells the panel the booking's status", () => {
    expect(page).toMatch(/<JobChatPanel[\s\S]{0,200}status=\{booking\.status\}/);
  });
});
