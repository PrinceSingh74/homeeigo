/**
 * Phase 06 — the reusable requirement catalogue (service_requirement_items). Admin-only writes,
 * audited through the existing AuditLogService; every service that assigns an item references it
 * by row id, so an item is never deleted — only archived (is_active = false), and archiving is
 * refused while any ACTIVE service assignment still uses it (the assignment must be removed first).
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { incCounter } from "../lib/metrics";
import { REQUIREMENT_KINDS, requirementCode, type RequirementKind } from "../lib/service-requirements";

export type RequirementItemInput = {
  code: string;
  kind: RequirementKind;
  name: string;
  customerLabel?: string | null;
  description?: string | null;
};

const SELECT = {
  id: true, code: true, kind: true, name: true, customerLabel: true, description: true, isActive: true, version: true,
  createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
} as const;

export const requirementCatalogService = {
  async list(query: { kind?: string; includeInactive?: boolean } = {}) {
    const kind = query.kind && (REQUIREMENT_KINDS as readonly string[]).includes(query.kind) ? (query.kind as RequirementKind) : undefined;
    const items = await prisma.serviceRequirementItem.findMany({
      where: { ...(kind ? { kind } : {}), ...(query.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { ...SELECT, _count: { select: { assignments: { where: { isActive: true } } } } },
    });
    return { items: items.map(({ _count, ...i }) => ({ ...i, activeAssignments: _count.assignments })) };
  },

  async create(input: RequirementItemInput, actorId?: string) {
    const code = requirementCode.safeParse(input.code);
    if (!code.success) return { error: "INVALID_INPUT" as const, message: "code: use lowercase words joined by single hyphens" };
    if (!(REQUIREMENT_KINDS as readonly string[]).includes(input.kind)) return { error: "INVALID_INPUT" as const, message: "kind is invalid" };
    const name = input.name?.trim();
    if (!name || name.length > 120) return { error: "INVALID_INPUT" as const, message: "name is required (≤ 120 characters)" };
    try {
      const item = await prisma.serviceRequirementItem.create({
        data: {
          id: `sri_${createHash("sha256").update(code.data).digest("hex").slice(0, 24)}`,
          code: code.data,
          kind: input.kind,
          name,
          customerLabel: input.customerLabel?.trim() || null,
          description: input.description?.trim() || null,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
        },
        select: SELECT,
      });
      void AuditLogService.record("ADMIN_ACTION", "success", {
        userId: actorId,
        details: { action: "REQUIREMENT_ITEM_CREATED", itemId: item.id, code: item.code, kind: item.kind, after: { name: item.name, customerLabel: item.customerLabel } },
      });
      incCounter("requirement_catalog_mutation_total", { action: "create" });
      return { item };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "DUPLICATE" as const, message: `An item with code "${code.data}" already exists` };
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2010" && /_check/.test(String(e.meta?.message ?? e.message))) {
        return { error: "INVALID_INPUT" as const, message: "item violates the catalogue rules" };
      }
      throw e;
    }
  },

  /** Compare-and-set on `version`: a stale editor gets VERSION_CONFLICT, never a silent overwrite. */
  async update(id: string, input: Partial<Pick<RequirementItemInput, "name" | "customerLabel" | "description">> & { isActive?: boolean; expectedVersion: number }, actorId?: string) {
    const before = await prisma.serviceRequirementItem.findUnique({ where: { id }, select: SELECT });
    if (!before) return { error: "NOT_FOUND" as const };
    if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120)) return { error: "INVALID_INPUT" as const, message: "name is required (≤ 120 characters)" };
    if (input.isActive === false && before.isActive) {
      const used = await prisma.serviceRequirement.count({ where: { itemId: id, isActive: true, service: { isActive: true } } });
      if (used > 0) return { error: "IN_USE" as const, message: `Item is assigned by ${used} active service(s); remove those assignments first` };
    }
    const res = await prisma.serviceRequirementItem.updateMany({
      where: { id, version: input.expectedVersion },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.customerLabel !== undefined ? { customerLabel: input.customerLabel?.trim() || null } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        version: { increment: 1 },
        updatedBy: actorId ?? null,
        updatedAt: new Date(),
      },
    });
    if (res.count === 0) return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first — reload and try again" };
    const item = await prisma.serviceRequirementItem.findUniqueOrThrow({ where: { id }, select: SELECT });
    void AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: {
        action: input.isActive === false ? "REQUIREMENT_ITEM_ARCHIVED" : "REQUIREMENT_ITEM_UPDATED",
        itemId: id, code: item.code, previousVersion: before.version, version: item.version,
        before: { name: before.name, customerLabel: before.customerLabel, description: before.description, isActive: before.isActive },
        after: { name: item.name, customerLabel: item.customerLabel, description: item.description, isActive: item.isActive },
      },
    });
    incCounter("requirement_catalog_mutation_total", { action: input.isActive === false ? "archive" : "update" });
    return { item };
  },
};
