import prisma from "../../lib/prisma";
import type { ToolDefinition, ToolRegistryEntry } from "../types";
import { TOOL_CATALOG } from "./tool-catalog";
import { registerToolHandlers } from "../execution/handlers";

const runtimeRegistry = new Map<string, ToolRegistryEntry>();

/** Initialize in-memory registry with handlers. */
export function initToolRegistry(): void {
  runtimeRegistry.clear();
  const withHandlers = registerToolHandlers(TOOL_CATALOG);
  for (const entry of withHandlers) {
    runtimeRegistry.set(entry.toolId, entry);
  }
}

export function getTool(toolId: string): ToolRegistryEntry | undefined {
  if (runtimeRegistry.size === 0) initToolRegistry();
  return runtimeRegistry.get(toolId);
}

export function listTools(filter?: {
  category?: string;
  status?: string;
  riskLevel?: string;
}): ToolRegistryEntry[] {
  if (runtimeRegistry.size === 0) initToolRegistry();
  let tools = [...runtimeRegistry.values()];
  if (filter?.category) tools = tools.filter((t) => t.category === filter.category);
  if (filter?.status) tools = tools.filter((t) => t.status === filter.status);
  if (filter?.riskLevel) tools = tools.filter((t) => t.riskLevel === filter.riskLevel);
  return tools;
}

export function getToolDefinition(toolId: string): ToolDefinition | undefined {
  const tool = getTool(toolId);
  if (!tool) return undefined;
  const { handler: _handler, ...def } = tool;
  return def;
}

/** Sync built-in catalog to ai_tool_registry table. */
export async function seedToolRegistry(): Promise<number> {
  if (runtimeRegistry.size === 0) initToolRegistry();
  let seeded = 0;
  for (const tool of TOOL_CATALOG) {
    await prisma.aiToolRegistry.upsert({
      where: { toolId: tool.toolId },
      create: {
        toolId: tool.toolId,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        version: tool.version,
        requiredPermission: tool.requiredPermission,
        requiredRole: tool.requiredRole,
        requiredPolicy: tool.requiredPolicy,
        riskLevel: tool.riskLevel,
        parameters: tool.parameters,
        validationSchema: tool.validationSchema,
        timeoutMs: tool.timeoutMs,
        maxRetries: tool.maxRetries,
        auditRequired: tool.auditRequired,
        approvalRequired: tool.approvalRequired,
        serviceMapping: tool.serviceMapping,
        eventMapping: tool.eventMapping,
        metricsKey: tool.metricsKey,
        costEstimateUsd: tool.costEstimateUsd,
        owner: tool.owner,
        status: tool.status,
      },
      update: {
        name: tool.name,
        description: tool.description,
        category: tool.category,
        version: tool.version,
        requiredPermission: tool.requiredPermission,
        requiredRole: tool.requiredRole,
        requiredPolicy: tool.requiredPolicy,
        riskLevel: tool.riskLevel,
        parameters: tool.parameters,
        validationSchema: tool.validationSchema,
        timeoutMs: tool.timeoutMs,
        maxRetries: tool.maxRetries,
        auditRequired: tool.auditRequired,
        approvalRequired: tool.approvalRequired,
        serviceMapping: tool.serviceMapping,
        eventMapping: tool.eventMapping,
        metricsKey: tool.metricsKey,
        costEstimateUsd: tool.costEstimateUsd,
        owner: tool.owner,
        status: tool.status,
      },
    });
    seeded++;
  }
  return seeded;
}

export async function listRegistryFromDb(filter?: {
  category?: string;
  status?: string;
}): Promise<Array<Record<string, unknown>>> {
  const where: Record<string, unknown> = {};
  if (filter?.category) where.category = filter.category;
  if (filter?.status) where.status = filter.status;
  return prisma.aiToolRegistry.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function getRegistryToolFromDb(toolId: string) {
  return prisma.aiToolRegistry.findUnique({ where: { toolId } });
}
