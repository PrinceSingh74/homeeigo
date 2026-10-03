import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { adminApiToken, adminLogin } from "./enterprise/fixtures";
import { COMMAND_CENTER_SURFACES, type CommandSurfaceId } from "../src/lib/command-center-ia";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SEED_PATH = path.join(__dirname, "enterprise", "ops-seed.json");
const BACKEND_ROOT = path.resolve(__dirname, "..", "..", "backend");
/**
 * Mirrors RESCHEDULABLE_BOOKING_STATUSES (apps/backend/src/lib/booking-state-machine.ts). The old
 * denylist (not cancel/reject[/complete]) picked EXPIRED or COMPLETED bookings, which the server
 * rightly refuses with BOOKING_NOT_RESCHEDULABLE — a failure that looked like a mutation defect.
 * The admin list returns statuses lower-cased ("pending"), so compare upper-cased.
 */
const RESCHEDULABLE = new Set(["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE"]);

function runBackendScript(scriptRel: string, args: string[] = []): string {
  // Same database as the backend under test: CI's throwaway homigo_db (`.env`, `--allow-live` only on
  // a GitHub Actions runner), or locally E2E_BACKEND_ENV_FILE=.env.test. The row-writing fixture
  // refuses a non-test database otherwise — it planted 12 bookings + commissions in live (2026-09-03..06).
  const envFile = process.env.E2E_BACKEND_ENV_FILE
    ?? (process.env.GITHUB_ACTIONS === "true" ? ".env" : ".env.test");
  const liveFlag = process.env.GITHUB_ACTIONS === "true" ? ["--allow-live"] : [];
  return execFileSync("bun", [`--env-file=${envFile}`, "run", scriptRel, ...args, ...liveFlag], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

function findActivityLog(marker: string): { found: boolean; id?: string; action?: string } {
  const out = runBackendScript("scripts/e2e-find-activity-log.ts", [marker]);
  const line = out.split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
  return JSON.parse(line) as { found: boolean; id?: string; action?: string };
}

function createDisposableFraudCommission(): { commissionId: string } {
  const out = runBackendScript("scripts/e2e-disposable-fraud-commission.ts");
  const line = out.split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
  const parsed = JSON.parse(line) as { commissionId?: string };
  if (!parsed.commissionId) throw new Error(`fraud commission fixture failed: ${out}`);
  return { commissionId: parsed.commissionId };
}

type OpsSeed = {
  adminId?: string;
  withdrawalId?: string;
  providerId?: string;
};

type Verdict = "VERIFIED" | "PARTIAL" | "N/A" | "FAIL";

type SurfaceRow = {
  id: CommandSurfaceId;
  href: string;
  status: Verdict;
  mutation: string;
  persist: string;
  audit: string;
  reason: string;
};

type ApiJson = { success?: boolean; data?: unknown; error?: string; message?: string };

function loadSeed(): OpsSeed | null {
  if (!fs.existsSync(SEED_PATH)) return null;
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as OpsSeed;
}

async function loginToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
}

async function api(token: string, method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: ApiJson = {};
  try {
    json = JSON.parse(text) as ApiJson;
  } catch {
    json = { error: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, json };
}

function jwtUserId(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      sub?: string;
      userId?: string;
      id?: string;
    };
    return payload.sub ?? payload.userId ?? payload.id ?? "";
  } catch {
    return "";
  }
}

function row(
  id: CommandSurfaceId,
  partial: Omit<SurfaceRow, "id" | "href">,
): SurfaceRow {
  const surface = COMMAND_CENTER_SURFACES.find((s) => s.id === id);
  if (!surface) throw new Error(`IA missing surface ${id}`);
  return { id, href: surface.href, ...partial };
}

async function assertPartnerDenied(partnerToken: string, method: string, pathname: string, body?: unknown) {
  const res = await api(partnerToken, method, pathname, body);
  expect([401, 403], `${method} ${pathname} partner got ${res.status}`).toContain(res.status);
}

async function pollAudit(
  token: string,
  match: (item: Record<string, unknown>) => boolean,
  actionQuery = "ADMIN_ACTION",
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const res = await api(token, "GET", `/api/admin/audit?limit=80&action=${encodeURIComponent(actionQuery)}`);
    expect(res.ok, JSON.stringify(res.json)).toBe(true);
    const items = ((res.json.data as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? []) as Array<
      Record<string, unknown>
    >;
    last = items.slice(0, 5);
    const hit = items.find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`audit row not found within ${timeoutMs}ms last=${JSON.stringify(last)}`);
}

test.describe("Section 10 mutation + audit (Pass 12)", () => {
  test("COMMAND_CENTER_SURFACES mutation matrix", async ({ page }) => {
    test.setTimeout(300_000);
    expect(COMMAND_CENTER_SURFACES.length, "IA must stay at 22 surfaces").toBe(22);

    await adminLogin(page);
    const token = await adminApiToken();
    expect(token.length).toBeGreaterThan(10);
    const partnerToken = await loginToken("partner@homigo.demo", "Homigo@123");
    expect(partnerToken.length).toBeGreaterThan(10);
    const customerToken = await loginToken("customer@homigo.demo", "Homigo@123");
    expect(customerToken.length).toBeGreaterThan(10);
    const seed = loadSeed();
    const actorId = jwtUserId(token) || seed?.adminId || "";
    const stamp = `s10p12-${Date.now()}`;
    const matrix: SurfaceRow[] = [];

    // --- overview (read-only pulse) ---
    {
      const res = await api(token, "GET", "/api/admin/command-center/overview");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("overview", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Read-only Partner OS pulse; GET /command-center/overview succeeded",
        }),
      );
    }

    // --- leads ---
    {
      const phone = `98${String(Date.now()).slice(-8)}`;
      const created = await api(token, "POST", "/api/admin/partner-acquisition/leads", {
        name: `Pass12 Lead ${stamp}`,
        phone,
        source: "DIRECT",
        city: "Bengaluru",
        notes: stamp,
        forceCreate: true,
      });
      expect(created.ok, JSON.stringify(created.json)).toBe(true);
      const lead = created.json.data as { id?: string };
      expect(lead?.id).toBeTruthy();
      const noteTitle = `CRM note ${stamp}`;
      const activity = await api(token, "POST", `/api/admin/partner-acquisition/leads/${lead.id}/activity`, {
        type: "NOTE",
        title: noteTitle,
        description: stamp,
      });
      expect(activity.ok, JSON.stringify(activity.json)).toBe(true);
      const got = await api(token, "GET", `/api/admin/partner-acquisition/leads/${lead.id}`);
      expect(got.ok, JSON.stringify(got.json)).toBe(true);
      const detail = got.json.data as { id?: string; activities?: Array<{ title?: string }> };
      expect(detail.id).toBe(lead.id);
      expect((detail.activities ?? []).some((a) => a.title === noteTitle)).toBe(true);
      matrix.push(
        row("leads", {
          status: "VERIFIED",
          mutation: `POST /partner-acquisition/leads + activity (${lead.id})`,
          persist: "GET lead includes NOTE activity",
          audit: "n/a — PartnerLeadActivity, not ActivityLog",
          reason: "CRM create + note persisted",
        }),
      );
    }

    // --- applications ---
    {
      const phone = `97${String(Date.now()).slice(-8)}`;
      const created = await api(token, "POST", "/api/admin/partner-acquisition/leads", {
        name: `Pass12 App ${stamp}`,
        phone,
        source: "DIRECT",
        forceCreate: true,
      });
      expect(created.ok, JSON.stringify(created.json)).toBe(true);
      const leadId = (created.json.data as { id?: string }).id;
      expect(leadId).toBeTruthy();
      const start = await api(token, "POST", `/api/admin/partner-acquisition/leads/${leadId}/start-application`);
      expect(start.ok, JSON.stringify(start.json)).toBe(true);
      const got = await api(token, "GET", `/api/admin/partner-acquisition/leads/${leadId}`);
      expect(got.ok).toBe(true);
      const status = (got.json.data as { status?: string }).status;
      expect(status).toBe("APPLICATION_STARTED");
      const queue = await api(token, "GET", "/api/admin/partner-acquisition/applications?limit=30");
      expect(queue.ok, JSON.stringify(queue.json)).toBe(true);
      matrix.push(
        row("applications", {
          status: "VERIFIED",
          mutation: `POST start-application on ${leadId}`,
          persist: "GET lead status=APPLICATION_STARTED",
          audit: "n/a — lead activity log only",
          reason: "HQ invite mutation; verifyBackgroundCheck not used (irreversible)",
        }),
      );
    }

    // --- verification ---
    {
      const res = await api(token, "GET", "/api/admin/partner-acquisition/verification?limit=5");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("verification", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "No safe approve seed; verifyBackgroundCheck is irreversible. Queue GET succeeded",
        }),
      );
    }

    // --- partners ---
    {
      const res = await api(token, "GET", "/api/admin/providers?limit=5");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      const data = res.json.data as { providers?: unknown[]; items?: unknown[] };
      expect(Array.isArray(data?.providers ?? data?.items ?? []) || typeof res.json.data === "object").toBe(true);
      matrix.push(
        row("partners", {
          status: "N/A",
          mutation: "none",
          persist: "GET /providers list succeeded",
          audit: "n/a",
          reason: "No safe partner mutation in panel (bans/suspend excluded); roster read only",
        }),
      );
    }

    // --- availability ---
    {
      const res = await api(token, "GET", "/api/admin/partner-availability?limit=5");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("availability", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Admin roster filter is a GET query, not a mutation",
        }),
      );
    }

    // --- live-ops ---
    {
      const res = await api(token, "GET", "/api/admin/ops-map");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("live-ops", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Live ops map is a read-only dashboard",
        }),
      );
    }

    // --- jobs ---
    {
      const list = await api(token, "GET", "/api/admin/bookings?limit=20");
      expect(list.ok, JSON.stringify(list.json)).toBe(true);
      const bookings = ((list.json.data as { bookings?: Array<{ id: string; status: string }> })?.bookings ?? []).filter(
        (b) => RESCHEDULABLE.has(b.status.toUpperCase()),
      );
      if (bookings.length === 0) {
        matrix.push(
          row("jobs", {
            status: "PARTIAL",
            mutation: "skipped",
            persist: "n/a",
            audit: "n/a",
            reason: "No reschedulable booking in admin list (seed missing)",
          }),
        );
      } else {
        const bookingId = bookings[0]!.id;
        const scheduledDate = new Date(Date.now() + (96 + Math.floor(Math.random() * 48)) * 3_600_000).toISOString();
        const reason = `Pass12 reschedule ${stamp}`;
        const mut = await api(token, "POST", `/api/admin/bookings/${bookingId}/reschedule`, {
          scheduledDate,
          reason,
        });
        expect(mut.ok, JSON.stringify(mut.json)).toBe(true);
        const got = await api(token, "GET", `/api/admin/bookings/${bookingId}`);
        expect(got.ok, JSON.stringify(got.json)).toBe(true);
        const payload = got.json.data as {
          booking?: { scheduledDate?: string };
          scheduledDate?: string;
          timeline?: Array<{ action?: string; label?: string; details?: string }>;
        };
        const persistedDate = payload.booking?.scheduledDate ?? payload.scheduledDate;
        expect(persistedDate, JSON.stringify(got.json)).toBeTruthy();
        expect(Math.abs(new Date(persistedDate!).getTime() - new Date(scheduledDate).getTime())).toBeLessThan(60_000);
        const timeline = payload.timeline ?? [];
        const audited = timeline.some(
          (e) =>
            /RESCHEDULE/i.test(`${e.action ?? ""} ${e.label ?? ""} ${e.details ?? ""}`) ||
            (e.details ?? "").includes(reason),
        );
        expect(audited, `timeline missing reschedule: ${JSON.stringify(timeline).slice(0, 800)}`).toBe(true);
        matrix.push(
          row("jobs", {
            status: "VERIFIED",
            mutation: `POST /bookings/${bookingId}/reschedule`,
            persist: "GET booking scheduledDate matches",
            audit: "ActivityLog ADMIN_BOOKING_RESCHEDULE via booking timeline",
            reason: "Admin reschedule persisted and audited",
          }),
        );
      }
    }

    // --- performance / earnings ---
    {
      const perf = await api(token, "GET", "/api/admin/workforce/analytics");
      expect(perf.ok, JSON.stringify(perf.json)).toBe(true);
      matrix.push(
        row("performance", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Workforce analytics dashboard is read-only",
        }),
      );
    }
    {
      const earn = await api(token, "GET", "/api/admin/finance/dashboard?days=30");
      expect(earn.ok, JSON.stringify(earn.json)).toBe(true);
      matrix.push(
        row("earnings", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Earnings hub reads finance dashboard; it does not post money",
        }),
      );
    }

    // --- payouts ---
    {
      const listed = await api(token, "GET", "/api/admin/finance/payouts");
      expect(listed.ok, JSON.stringify(listed.json)).toBe(true);
      const data = listed.json.data as {
        queue?: Array<{ id?: string; status?: string }>;
        payouts?: Array<{ id?: string; status?: string }>;
      };
      const eligible = [...(data.queue ?? []), ...(data.payouts ?? [])].filter((w) =>
        /REQUESTED|APPROVED/i.test(String(w.status ?? "")),
      );
      const ordered = [
        ...eligible.filter((w) => w.id === seed?.withdrawalId),
        ...eligible.filter((w) => w.id !== seed?.withdrawalId),
      ];
      let withdrawalId: string | undefined;
      let batchId: string | undefined;
      let lastBatchErr = "";
      for (const w of ordered) {
        if (!w.id) continue;
        const create = await api(token, "POST", "/api/admin/finance/payouts/batch", {
          withdrawalIds: [w.id],
        });
        if (create.ok) {
          withdrawalId = w.id;
          batchId = (create.json.data as { batch?: { id?: string } })?.batch?.id;
          break;
        }
        lastBatchErr = JSON.stringify(create.json).slice(0, 240);
      }
      if (!withdrawalId || !batchId) {
        matrix.push(
          row("payouts", {
            status: "PARTIAL",
            mutation: "skipped",
            persist: "GET /finance/payouts succeeded",
            audit: "n/a",
            reason: lastBatchErr
              ? `No unused REQUESTED/APPROVED withdrawal (ops-seed ${seed?.withdrawalId ?? "missing"}): ${lastBatchErr}`
              : `No REQUESTED/APPROVED withdrawal (ops-seed ${seed?.withdrawalId ?? "missing"} not eligible)`,
          }),
        );
      } else {
        const got = await api(token, "GET", `/api/admin/finance/payouts/batch/${batchId}`);
        expect(got.ok, JSON.stringify(got.json)).toBe(true);
        await pollAudit(
          token,
          (i) => String(i.action) === "PAYOUT_BATCH_PROCESSED" && String(i.actor ?? "") === actorId,
          "PAYOUT_BATCH_PROCESSED",
        );
        matrix.push(
          row("payouts", {
            status: "VERIFIED",
            mutation: `POST payouts/batch with ${withdrawalId}`,
            persist: `GET batch ${batchId}`,
            audit: "PAYOUT_BATCH_PROCESSED enterprise audit + ActivityLog",
            reason: "Draft payout batch created from eligible withdrawal",
          }),
        );
      }
    }

    // --- incentives ---
    {
      const res = await api(token, "GET", "/api/admin/incentives/rules");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("incentives", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Command Center incentives surface is rules GET only (no PATCH on this route)",
        }),
      );
    }

    // --- kyc ---
    {
      matrix.push(
        row("kyc", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "KYC hub is a link page; no approve mutation on /kyc",
        }),
      );
    }

    // --- training ---
    {
      const slug = `pass12-${Date.now().toString(36)}`;
      const title = `Pass12 academy ${stamp}`;
      const created = await api(token, "POST", "/api/admin/academy/modules", {
        slug,
        title,
        contentType: "article",
        contentBody: stamp,
        isPublished: false,
      });
      expect(created.ok, JSON.stringify(created.json)).toBe(true);
      const moduleId = (created.json.data as { module?: { id?: string } })?.module?.id;
      expect(moduleId).toBeTruthy();
      const catalog = await api(token, "GET", "/api/admin/academy/modules");
      expect(catalog.ok, JSON.stringify(catalog.json)).toBe(true);
      const modules = ((catalog.json.data as { modules?: Array<{ id?: string; title?: string }> })?.modules ??
        []) as Array<{ id?: string; title?: string }>;
      expect(modules.some((m) => m.id === moduleId && m.title === title)).toBe(true);
      matrix.push(
        row("training", {
          status: "VERIFIED",
          mutation: `POST /academy/modules ${moduleId} unpublished`,
          persist: "GET catalog contains module",
          audit: "n/a — academyAdminService does not write ActivityLog",
          reason: "Draft catalog module; not published",
        }),
      );
    }

    // --- referrals (disposable invite → hold + audit) ---
    {
      const overview = await api(token, "GET", "/api/admin/partner-referrals/overview");
      expect(overview.ok, JSON.stringify(overview.json)).toBe(true);
      const analytics = await api(token, "GET", "/api/admin/referrals/analytics");
      expect(analytics.ok, JSON.stringify(analytics.json)).toBe(true);
      await assertPartnerDenied(partnerToken, "POST", "/api/admin/partner-referrals/placeholder/action", {
        action: "block",
        reason: "e2e deny",
      });

      const phone = `95${String(Date.now()).slice(-8)}`;
      const holdReason = `Pass12 referral hold ${stamp}`;
      const invite = await api(partnerToken, "POST", "/api/providers/me/network/invite", {
        name: `Pass12 Referral ${stamp}`,
        phone,
        city: "Bengaluru",
        campaign: "s10-mutation-audit",
      });
      expect(invite.ok, JSON.stringify(invite.json)).toBe(true);
      const referralId = (invite.json.data as { referralId?: string })?.referralId;
      expect(referralId).toBeTruthy();

      const hold = await api(token, "POST", `/api/admin/partner-referrals/${referralId}/action`, {
        action: "hold",
        reason: holdReason,
      });
      expect(hold.ok, JSON.stringify(hold.json)).toBe(true);

      const got = await api(token, "GET", `/api/admin/partner-referrals/${referralId}`);
      expect(got.ok, JSON.stringify(got.json)).toBe(true);
      const detail = got.json.data as { id?: string; reviewStatus?: string; blockedReason?: string };
      expect(detail.id).toBe(referralId);
      expect(detail.reviewStatus).toBe("HELD");
      expect(detail.blockedReason).toBe(holdReason);

      const activity = findActivityLog(holdReason);
      expect(activity.found, `ActivityLog missing hold reason ${holdReason}`).toBe(true);
      expect(String(activity.action)).toBe("ADMIN_ACTION");
      await pollAudit(token, (i) => String(i.action) === "ADMIN_ACTION" && String(i.actor ?? "") === actorId);

      matrix.push(
        row("referrals", {
          status: "VERIFIED",
          mutation: `POST /partner-referrals/${referralId}/action hold`,
          persist: "GET referral reviewStatus=HELD + blockedReason",
          audit: "ActivityLog ADMIN_ACTION (PARTNER_REFERRAL_HOLD) + enterprise ADMIN_ACTION",
          reason: "Disposable partner invite held; partner RBAC deny retained",
        }),
      );
    }

    // --- support ---
    {
      let ticketId: string | undefined;
      const existing = await api(token, "GET", "/api/admin/support/tickets?limit=5");
      expect(existing.ok, JSON.stringify(existing.json)).toBe(true);
      const tickets = (
        (existing.json.data as { tickets?: Array<{ id: string }> })?.tickets ??
        (existing.json.data as { items?: Array<{ id: string }> })?.items ??
        []
      ) as Array<{ id: string }>;
      ticketId = tickets[0]?.id;
      if (!ticketId) {
        const created = await api(customerToken, "POST", "/api/support/tickets", {
          subject: `Pass12 support ${stamp}`,
          description: `Customer ticket for section 10 mutation audit ${stamp}`,
          category: "general",
        });
        expect(created.ok, JSON.stringify(created.json)).toBe(true);
        ticketId = (created.json.data as { ticket?: { id?: string } })?.ticket?.id;
      }
      expect(ticketId).toBeTruthy();
      const marker = `Pass12 admin reply ${stamp}`;
      const reply = await api(token, "POST", `/api/admin/support/tickets/${ticketId}/respond`, {
        resolution: marker,
        internal: true,
      });
      expect(reply.ok, JSON.stringify(reply.json)).toBe(true);
      const got = await api(token, "GET", `/api/admin/support/tickets/${ticketId}`);
      expect(got.ok, JSON.stringify(got.json)).toBe(true);
      const messages = ((got.json.data as { ticket?: { messages?: Array<{ body?: string }> } })?.ticket?.messages ??
        (got.json.data as { messages?: Array<{ body?: string }> })?.messages ??
        []) as Array<{ body?: string }>;
      expect(messages.some((m) => (m.body ?? "").includes(marker))).toBe(true);
      matrix.push(
        row("support", {
          status: "VERIFIED",
          mutation: `POST /support/tickets/${ticketId}/respond internal`,
          persist: "GET ticket messages contain reply",
          audit: "n/a — supportTicketService does not write ActivityLog on respond",
          reason: "Admin reply persisted on ticket thread",
        }),
      );
    }

    // --- safety (disposable partner report → ack + resolve) ---
    {
      const overview = await api(token, "GET", "/api/admin/trust-safety/overview");
      expect(overview.ok, JSON.stringify(overview.json)).toBe(true);
      await assertPartnerDenied(partnerToken, "POST", "/api/admin/trust-safety/incidents/placeholder/acknowledge");

      const notes = `Pass12 safety report ${stamp}`;
      const resolveNotes = `Pass12 safety resolve ${stamp}`;
      const reported = await api(partnerToken, "POST", "/api/providers/me/safety/report", {
        type: "OTHER",
        notes,
      });
      expect(reported.ok, JSON.stringify(reported.json)).toBe(true);
      const incidentId = (reported.json.data as { incidentId?: string })?.incidentId;
      expect(incidentId).toBeTruthy();

      const ack = await api(token, "POST", `/api/admin/trust-safety/incidents/${incidentId}/acknowledge`);
      expect(ack.ok, JSON.stringify(ack.json)).toBe(true);
      const resolve = await api(token, "POST", `/api/admin/trust-safety/incidents/${incidentId}/resolve`, {
        notes: resolveNotes,
      });
      expect(resolve.ok, JSON.stringify(resolve.json)).toBe(true);

      const got = await api(token, "GET", `/api/admin/trust-safety/incidents/${incidentId}`);
      expect(got.ok, JSON.stringify(got.json)).toBe(true);
      const detail = got.json.data as {
        id?: string;
        status?: string;
        resolutionNotes?: string;
        timeline?: Array<{ action?: string; description?: string }>;
      };
      expect(detail.id).toBe(incidentId);
      expect(detail.status).toBe("RESOLVED");
      expect(detail.resolutionNotes).toBe(resolveNotes);
      const timeline = detail.timeline ?? [];
      expect(
        timeline.some((e) => e.action === "SAFETY_INCIDENT_ACKNOWLEDGED"),
        `missing ACK in timeline: ${JSON.stringify(timeline).slice(0, 800)}`,
      ).toBe(true);
      expect(
        timeline.some(
          (e) => e.action === "SAFETY_INCIDENT_RESOLVED" && (e.description ?? "").includes(resolveNotes.slice(0, 40)),
        ),
        `missing RESOLVED in timeline: ${JSON.stringify(timeline).slice(0, 800)}`,
      ).toBe(true);

      matrix.push(
        row("safety", {
          status: "VERIFIED",
          mutation: `POST report + acknowledge + resolve ${incidentId}`,
          persist: "GET incident status=RESOLVED + resolutionNotes",
          audit: "ActivityLog SAFETY_INCIDENT_ACKNOWLEDGED/RESOLVED via incident timeline",
          reason: "Disposable OTHER incident; partner RBAC deny retained",
        }),
      );
    }

    // --- fraud (disposable PENDING commission → reject) ---
    {
      const overview = await api(token, "GET", "/api/admin/fraud/overview");
      expect(overview.ok, JSON.stringify(overview.json)).toBe(true);
      await assertPartnerDenied(partnerToken, "POST", "/api/admin/fraud/users/placeholder/blacklist", {
        reason: "e2e deny",
      });

      const { commissionId } = createDisposableFraudCommission();
      const rejectReason = `Pass12 fraud reject ${stamp}`;
      const rejected = await api(token, "POST", `/api/admin/fraud/commissions/${commissionId}/reject`, {
        reason: rejectReason,
      });
      expect(rejected.ok, JSON.stringify(rejected.json)).toBe(true);
      const commission = (rejected.json.data as { commission?: { id?: string; status?: string } })?.commission;
      expect(commission?.id).toBe(commissionId);
      expect(String(commission?.status).toUpperCase()).toBe("REJECTED");

      const decisions = await api(token, "GET", "/api/admin/fraud/decisions?limit=40");
      expect(decisions.ok, JSON.stringify(decisions.json)).toBe(true);
      const logs = ((decisions.json.data as { logs?: Array<Record<string, unknown>> })?.logs ?? []) as Array<
        Record<string, unknown>
      >;
      const decisionHit = logs.find(
        (l) =>
          String(l.action) === "REJECT_COMMISSION" &&
          String(l.targetCommissionId) === commissionId &&
          String(l.reason ?? "") === rejectReason,
      );
      expect(decisionHit, `fraud decision missing: ${JSON.stringify(logs.slice(0, 5))}`).toBeTruthy();

      matrix.push(
        row("fraud", {
          status: "VERIFIED",
          mutation: `POST /fraud/commissions/${commissionId}/reject`,
          persist: "reject response status=REJECTED",
          audit: "FraudDecisionLog REJECT_COMMISSION (no ActivityLog on this path)",
          reason: "Disposable PENDING commission rejected; partner RBAC deny retained",
        }),
      );
    }

    // --- acquisition-analytics / supply-demand / ai-insights / audit ---
    {
      const res = await api(token, "GET", "/api/admin/partner-acquisition/dashboard?range=30d");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("acquisition-analytics", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Funnel analytics dashboard is read-only",
        }),
      );
    }
    {
      matrix.push(
        row("supply-demand", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "Hub page only; heatmap/coverage engines are read-only",
        }),
      );
    }
    {
      const res = await api(token, "GET", "/api/admin/intelligence/executive-brief");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("ai-insights", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "n/a",
          reason: "AI Insights hub routes to canonical intel; no mutation on this surface",
        }),
      );
    }
    {
      const res = await api(token, "GET", "/api/admin/audit?limit=5");
      expect(res.ok, JSON.stringify(res.json)).toBe(true);
      matrix.push(
        row("audit", {
          status: "N/A",
          mutation: "none",
          persist: "n/a",
          audit: "explorer is the reader, not a writer",
          reason: "Audit explorer is read-only; writers are domain mutations (see convergence test)",
        }),
      );
    }

    const byId = new Map(matrix.map((r) => [r.id, r]));
    for (const surface of COMMAND_CENTER_SURFACES) {
      expect(byId.has(surface.id), `missing matrix row for ${surface.id}`).toBe(true);
    }
    expect(matrix.length).toBe(COMMAND_CENTER_SURFACES.length);
    expect(matrix.filter((r) => r.status === "FAIL")).toEqual([]);
    console.log("SECTION10_MUTATION_MATRIX\n" + JSON.stringify(matrix, null, 2));
  });

  test("AUDIT CONVERGENCE: admin action → API → ActivityLog + enterprise audit", async () => {
    test.setTimeout(120_000);
    const token = await adminApiToken();
    expect(token.length).toBeGreaterThan(10);
    const actorId = jwtUserId(token);
    expect(actorId.length).toBeGreaterThan(5);

    const list = await api(token, "GET", "/api/admin/bookings?limit=20");
    expect(list.ok, JSON.stringify(list.json)).toBe(true);
    const bookings = ((list.json.data as { bookings?: Array<{ id: string; status: string }> })?.bookings ?? []).filter(
      (b) => RESCHEDULABLE.has(b.status.toUpperCase()),
    );
    expect(bookings.length, "need a reschedulable booking (PENDING/ACCEPTED/ASSIGNED/EN_ROUTE) for audit convergence").toBeGreaterThan(0);
    const bookingId = bookings[0]!.id;
    const marker = `Pass12-AUDIT-${Date.now()}`;
    const scheduledDate = new Date(Date.now() + (120 + Math.floor(Math.random() * 36)) * 3_600_000).toISOString();

    const mut = await api(token, "POST", `/api/admin/bookings/${bookingId}/reschedule`, {
      scheduledDate,
      reason: marker,
    });
    expect(mut.ok, JSON.stringify(mut.json)).toBe(true);

    const detail = await api(token, "GET", `/api/admin/bookings/${bookingId}`);
    expect(detail.ok).toBe(true);
    const timeline = ((detail.json.data as { timeline?: Array<{ action?: string; label?: string; details?: string }> })
      ?.timeline ?? []) as Array<{ action?: string; label?: string; details?: string }>;
    const activityHit = timeline.find((e) => (e.details ?? "").includes(marker) || /RESCHEDULE/i.test(e.label ?? ""));
    expect(activityHit, JSON.stringify(timeline).slice(0, 1200)).toBeTruthy();

    const auditRow = await pollAudit(token, (item) => {
      return (
        String(item.action) === "ADMIN_ACTION" &&
        String(item.actor) === actorId &&
        String(item.changesSummary ?? "").includes(marker)
      );
    });
    expect(auditRow.actor).toBe(actorId);
    expect(String(auditRow.action)).toBe("ADMIN_ACTION");
    expect(String(auditRow.resource ?? "")).toBeTruthy();
    expect(String(auditRow.changesSummary)).toContain(marker);
    expect(auditRow.actorType === "ADMIN" || auditRow.actorType === "USER").toBe(true);
  });
});
