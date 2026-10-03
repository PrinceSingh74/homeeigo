import type { AiGatewayRole } from "@prisma/client";

/**
 * Shape of a prompt template. Lives in its own leaf module so that template *data* files
 * (phase16-agent-templates.ts) can type themselves without importing the registry that imports
 * them back — that pair was an import cycle.
 */
export type PromptTemplate = {
  templateId: string;
  name: string;
  category: string;
  actorRole: AiGatewayRole;
  systemPrompt: string;
  userTemplate?: string;
  maxTokens: number;
};
