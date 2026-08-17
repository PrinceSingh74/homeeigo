import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import type { NotificationCategory, NotificationChannel } from "@prisma/client";

/**
 * Templates are defined in code and snapshotted to the database on activation — the same
 * separation Phase 6A uses for workflow definitions, and for the same reason: a database row
 * should be able to describe a message, never to introduce one.
 *
 * Variables are declared, typed and closed. A template renders only the names it lists, so a
 * caller cannot smuggle an extra field into a message, and a template cannot quietly start
 * reading something it was never reviewed for.
 */

export type VariableType = "string" | "number" | "boolean";

export type TemplateDefinition = {
  templateId: string;
  version: number;
  notificationType: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  language: string;
  title?: string;
  body: string;
  variables: Record<string, VariableType>;
};

const registry = new Map<string, TemplateDefinition>();

const key = (templateId: string, version: number) => `${templateId}.v${version}`;

/** `{{name}}` — the only substitution syntax. No expressions, no logic, no nesting. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export function registerTemplate(def: TemplateDefinition): void {
  const id = key(def.templateId, def.version);
  if (registry.has(id)) throw new Error(`Template ${id} already registered — publish a new version`);

  // Every placeholder must be declared. A template referring to an undeclared variable would
  // render an empty hole in a real message, which is the kind of defect nobody notices until a
  // customer sees "Hi ,".
  const used = new Set([...placeholdersIn(def.body), ...placeholdersIn(def.title ?? "")]);
  for (const name of used) {
    if (!(name in def.variables)) {
      throw new Error(`Template ${id} uses undeclared variable "${name}"`);
    }
  }
  registry.set(id, def);
}

export function getTemplate(templateId: string, version: number): TemplateDefinition | undefined {
  return registry.get(key(templateId, version));
}

export function listTemplates(): TemplateDefinition[] {
  return [...registry.values()];
}

/** Test-only. */
export function clearTemplates(): void {
  registry.clear();
}

export type VariableValidation = { ok: true; values: Record<string, string> } | { ok: false; error: string };

/**
 * Validates supplied variables against the template's declaration.
 *
 * Closed in both directions: a missing required variable is an error, and so is an undeclared
 * extra one. Rejecting extras matters as much as rejecting omissions — it is what stops a caller
 * passing a whole customer record in the hope that the template picks out the useful parts.
 */
export function validateVariables(
  def: TemplateDefinition,
  supplied: Record<string, unknown>,
): VariableValidation {
  const values: Record<string, string> = {};

  for (const [name, type] of Object.entries(def.variables)) {
    const value = supplied[name];
    if (value === undefined || value === null) return { ok: false, error: `missing variable "${name}"` };
    if (typeof value !== type) {
      return { ok: false, error: `variable "${name}" expected ${type}, got ${typeof value}` };
    }
    values[name] = String(value);
  }

  for (const name of Object.keys(supplied)) {
    if (!(name in def.variables)) return { ok: false, error: `undeclared variable "${name}"` };
  }

  return { ok: true, values };
}

/** Substitutes declared variables. Values are inserted as text and are never interpreted. */
export function render(def: TemplateDefinition, values: Record<string, string>): { title: string | null; body: string } {
  const fill = (text: string) => text.replace(PLACEHOLDER, (_m, name: string) => values[name] ?? "");
  return { title: def.title ? fill(def.title) : null, body: fill(def.body) };
}

/**
 * Picks the template for a request.
 *
 * Language falls back to English when a translation does not exist yet, because a message in the
 * wrong language still reaches the person; no template at all does not. Absence of any match is a
 * refusal, never a raw-text fallback from calling code.
 */
export function resolveTemplate(input: {
  notificationType: string;
  channel: NotificationChannel;
  language: string;
}): TemplateDefinition | undefined {
  const candidates = [...registry.values()].filter(
    (t) => t.notificationType === input.notificationType && t.channel === input.channel,
  );
  const exact = candidates.filter((t) => t.language === input.language);
  const pool = exact.length ? exact : candidates.filter((t) => t.language === "en");
  return pool.sort((a, b) => b.version - a.version)[0];
}

/** Mirrors the code registry into the database, and refuses to rewrite an activated version. */
export async function syncTemplates(): Promise<{ created: number; updated: number; unchanged: number }> {
  let created = 0, updated = 0, unchanged = 0;

  for (const def of registry.values()) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { templateId_version: { templateId: def.templateId, version: def.version } },
    });

    const payload = {
      notificationType: def.notificationType,
      category: def.category,
      channel: def.channel,
      language: def.language,
      title: def.title ?? null,
      body: def.body,
      variablesSchema: def.variables as unknown as object,
    };

    if (!existing) {
      await prisma.notificationTemplate.create({
        data: { templateId: def.templateId, version: def.version, ...payload },
      });
      created++;
      continue;
    }

    if (existing.activatedAt) {
      if (existing.body !== def.body || existing.title !== (def.title ?? null)) {
        throw new Error(
          `Template ${key(def.templateId, def.version)} was activated on ${existing.activatedAt.toISOString()} ` +
            `and its content has since changed. Activated versions are immutable — publish v${def.version + 1}.`,
        );
      }
      unchanged++;
      continue;
    }

    await prisma.notificationTemplate.update({ where: { id: existing.id }, data: payload });
    updated++;
  }

  logger.info("notification_templates_synced", { created, updated, unchanged });
  return { created, updated, unchanged };
}

export async function activateTemplate(templateId: string, version: number): Promise<void> {
  await prisma.notificationTemplate.update({
    where: { templateId_version: { templateId, version } },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
}
