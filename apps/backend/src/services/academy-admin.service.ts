import prisma from "../lib/prisma";
import { sanitizePlainText, sanitizeUrl } from "../utils/sanitizer";

const CONTENT_TYPES = new Set(["video", "sop", "assessment", "article"]);

export type AcademyModuleInput = {
  slug: string;
  title: string;
  contentType: string;
  contentUrl?: string;
  contentBody?: string;
  sortOrder?: number;
  isPublished?: boolean;
  categoryIds?: string[];
};

export type AcademyModulePatch = {
  title?: string;
  contentType?: string;
  contentUrl?: string | null;
  contentBody?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
  categoryIds?: string[];
};

function slugify(value: string) {
  const s = sanitizePlainText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 80) || "module";
}

function contentTypeOf(raw: string) {
  const t = sanitizePlainText(raw).toLowerCase().replace(/\s+/g, "_").slice(0, 32);
  return CONTENT_TYPES.has(t) ? t : t || "article";
}

function partnerName(p: {
  businessName: string | null;
  user: { firstName: string; lastName: string };
}) {
  return p.businessName || `${p.user.firstName} ${p.user.lastName}`.trim() || "Partner";
}

export class AcademyAdminService {
  async listCatalog() {
    const [modules, completedAgg, startedAgg, learnerRows, certifiedPartners, categories, recent] =
      await Promise.all([
        prisma.partnerAcademyModule.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }),
        prisma.partnerAcademyProgress.groupBy({
          by: ["moduleId"],
          where: { completedAt: { not: null } },
          _count: { _all: true },
          _avg: { score: true },
        }),
        prisma.partnerAcademyProgress.groupBy({
          by: ["moduleId"],
          _count: { _all: true },
        }),
        prisma.partnerAcademyProgress.groupBy({
          by: ["providerId"],
          _count: { _all: true },
        }),
        prisma.provider.count({ where: { NOT: { certifications: { equals: [] } } } }),
        prisma.service.findMany({
          where: { isActive: true },
          distinct: ["category"],
          select: { category: true },
          orderBy: { category: "asc" },
        }),
        prisma.partnerAcademyProgress.findMany({
          where: { completedAt: { not: null } },
          orderBy: { completedAt: "desc" },
          take: 40,
          select: {
            moduleId: true,
            completedAt: true,
            score: true,
            provider: {
              select: {
                id: true,
                businessName: true,
                city: true,
                user: { select: { firstName: true, lastName: true } },
              },
            },
          },
        }),
      ]);

    const completedBy = new Map(completedAgg.map((r) => [r.moduleId, r]));
    const startedBy = new Map(startedAgg.map((r) => [r.moduleId, r._count._all]));
    const recentBy = new Map<string, typeof recent>();
    for (const row of recent) {
      const list = recentBy.get(row.moduleId) ?? [];
      if (list.length < 6) {
        list.push(row);
        recentBy.set(row.moduleId, list);
      }
    }

    const published = modules.filter((m) => m.isPublished).length;
    const completionRows = completedAgg.reduce((s, r) => s + r._count._all, 0);
    const scoreVals = completedAgg
      .map((r) => r._avg.score)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const avgScore =
      scoreVals.length > 0 ? Math.round((scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) * 10) / 10 : null;

    return {
      modules: modules.map((m) => {
        const done = completedBy.get(m.id);
        return {
          id: m.id,
          slug: m.slug,
          title: m.title,
          contentType: m.contentType,
          contentUrl: m.contentUrl,
          body: m.body,
          sortOrder: m.sortOrder,
          isPublished: m.isPublished,
          categoryIds: m.categoryIds,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          stats: {
            started: startedBy.get(m.id) ?? 0,
            completed: done?._count._all ?? 0,
            avgScore: done?._avg.score != null ? Math.round(done._avg.score * 10) / 10 : null,
          },
          recentCompletions: (recentBy.get(m.id) ?? []).map((r) => ({
            providerId: r.provider.id,
            name: partnerName(r.provider),
            city: r.provider.city,
            completedAt: r.completedAt!.toISOString(),
            score: r.score,
          })),
        };
      }),
      summary: {
        total: modules.length,
        published,
        drafts: modules.length - published,
        completions: completionRows,
        learners: learnerRows.length,
        avgScore,
        certifiedPartners,
        catalogCategories: categories.map((c) => c.category).filter(Boolean),
      },
    };
  }

  async createModule(input: AcademyModuleInput) {
    const title = sanitizePlainText(input.title).slice(0, 120);
    if (title.length < 2) throw new Error("Title is required");

    let slug = slugify(input.slug || title);
    const clash = await prisma.partnerAcademyModule.findUnique({ where: { slug }, select: { id: true } });
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;

    const url = input.contentUrl?.trim() ? sanitizeUrl(input.contentUrl) : null;
    const body = input.contentBody ? input.contentBody.replace(/<[^>]*>/g, "").trim().slice(0, 8000) : null;

    const last = await prisma.partnerAcademyModule.aggregate({ _max: { sortOrder: true } });

    return prisma.partnerAcademyModule.create({
      data: {
        slug,
        title,
        contentType: contentTypeOf(input.contentType),
        contentUrl: url,
        body,
        sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
        isPublished: Boolean(input.isPublished),
        categoryIds: (input.categoryIds ?? []).map((c) => sanitizePlainText(c).slice(0, 80)).filter(Boolean),
      },
    });
  }

  async patchModule(id: string, patch: AcademyModulePatch) {
    const existing = await prisma.partnerAcademyModule.findUnique({ where: { id } });
    if (!existing) return null;

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = sanitizePlainText(patch.title).slice(0, 120);
      if (title.length < 2) throw new Error("Title is required");
      data.title = title;
    }
    if (patch.contentType !== undefined) data.contentType = contentTypeOf(patch.contentType);
    if (patch.contentUrl !== undefined) {
      data.contentUrl = patch.contentUrl?.trim() ? sanitizeUrl(patch.contentUrl) : null;
    }
    if (patch.contentBody !== undefined) {
      data.body = patch.contentBody ? patch.contentBody.replace(/<[^>]*>/g, "").trim().slice(0, 8000) : null;
    }
    if (typeof patch.sortOrder === "number") data.sortOrder = patch.sortOrder;
    if (typeof patch.isPublished === "boolean") data.isPublished = patch.isPublished;
    if (patch.categoryIds) {
      data.categoryIds = patch.categoryIds.map((c) => sanitizePlainText(c).slice(0, 80)).filter(Boolean);
    }

    return prisma.partnerAcademyModule.update({ where: { id }, data });
  }
}

export const academyAdminService = new AcademyAdminService();
