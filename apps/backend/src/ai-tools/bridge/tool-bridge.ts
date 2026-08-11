import type { AiGatewayRole } from "@prisma/client";
import type { AiIntent } from "../../ai/intent/intent-classifier";
import type { AiMessage, AiProviderResponse, ProviderToolCall } from "../../ai/types";
import { getAvailableAiTools, toProviderToolSchemas, fromProviderToolName } from "../registry/tool-discovery";
import { getTool } from "../registry/tool-registry";
import { executeTool, ToolExecutionError } from "../execution/execution-engine";
import { sanitizeToolResult, renderToolResultForPrompt } from "../security/tool-result-safety";
import { aiToolsConfig } from "../config";
import { recordToolBridgeRound, recordToolBridgeRejected } from "../../lib/ai-tools-metrics";
import { logger } from "../../lib/logger";
import type { ToolActorContext } from "../types";

/**
 * The orchestrator between the model and the tool layer.
 *
 * The model proposes; this decides. Every call it makes is re-derived server-side: the
 * tool name is mapped back through the registry rather than used as given, the arguments
 * are schema-validated, and execution goes through the same policy, ownership, approval
 * and audit path a direct API caller would hit. Nothing the model emits is trusted —
 * not the tool name, not an id, not an amount, and not an approval reference.
 *
 * Results return fenced and sanitized, so a booking note cannot become an instruction on
 * the next round.
 */

export type ToolCallRecord = {
  round: number;
  requestedTool: string;
  resolvedToolId?: string;
  status: "EXECUTED" | "REJECTED" | "FAILED" | "CONFIRMATION_REQUIRED" | "APPROVAL_REQUIRED";
  failureCode?: string;
  durationMs: number;
};

export type ToolBridgeResult = {
  /** Final assistant text, produced after every tool round completed. */
  content: string;
  /** Provider that produced the final answer. */
  provider: string;
  model: string;
  rounds: number;
  toolCalls: ToolCallRecord[];
  /** True when the loop stopped on the round limit rather than on a finished answer. */
  loopLimitHit: boolean;
  promptTokens: number;
  completionTokens: number;
};

export type ToolBridgeInput = {
  actor: ToolActorContext;
  intent?: AiIntent;
  systemPrompt: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** Write tools are only offered when the surface can carry a confirmation step. */
  allowWrites?: boolean;
  /** Injected so the bridge reuses the frozen router rather than calling providers itself. */
  route: (input: {
    systemPrompt: string;
    messages: AiMessage[];
    maxTokens?: number;
    tools?: Array<Record<string, unknown>>;
  }) => Promise<AiProviderResponse>;
};

/** Parses model-supplied JSON without ever evaluating it. */
function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolves a model-supplied function name to a registered tool the actor may actually use.
 *
 * Two separate checks, deliberately. Registry membership stops an invented name; the
 * discovery allowlist stops a *real* name the actor was never shown — the model could
 * otherwise reach a tool by guessing its id from another role's vocabulary.
 */
function resolveRequestedTool(
  requestedName: string,
  allowedToolIds: Set<string>,
): { ok: true; toolId: string } | { ok: false; reason: string } {
  const toolId = fromProviderToolName(requestedName);

  if (!getTool(toolId)) return { ok: false, reason: "TOOL_NOT_FOUND" };
  if (!allowedToolIds.has(toolId)) return { ok: false, reason: "TOOL_NOT_PERMITTED" };
  return { ok: true, toolId };
}

async function runOneToolCall(params: {
  call: ProviderToolCall;
  allowedToolIds: Set<string>;
  actor: ToolActorContext;
  round: number;
}): Promise<{ record: ToolCallRecord; message: AiMessage }> {
  const { call, allowedToolIds, actor, round } = params;
  const t0 = Date.now();

  const reject = (reason: string, note: string): { record: ToolCallRecord; message: AiMessage } => {
    recordToolBridgeRejected(reason);
    return {
      record: {
        round,
        requestedTool: call.name,
        status: "REJECTED",
        failureCode: reason,
        durationMs: Date.now() - t0,
      },
      // The model is told plainly that the call did not run, so it cannot report success.
      message: { role: "tool", toolCallId: call.id, content: JSON.stringify({ ok: false, error: reason, note }) },
    };
  };

  const resolved = resolveRequestedTool(call.name, allowedToolIds);
  if (!resolved.ok) {
    return reject(resolved.reason, "This tool is not available to you. Do not claim it ran.");
  }

  const args = parseArguments(call.argumentsJson);
  if (args === null) {
    return reject("INVALID_ARGUMENT", "Arguments were not valid JSON object. Do not retry blindly.");
  }

  try {
    const result = await executeTool({
      toolId: resolved.toolId,
      arguments: args,
      actor,
      // Confirmation and approval are never satisfied from inside a model turn. A write
      // that needs consent comes back as a stop, and the surface asks the user.
    });

    if (result.requiresConfirmation) {
      return {
        record: { round, requestedTool: call.name, resolvedToolId: resolved.toolId, status: "CONFIRMATION_REQUIRED", failureCode: "CONFIRMATION_REQUIRED", durationMs: Date.now() - t0 },
        message: {
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            status: "CONFIRMATION_REQUIRED",
            prompt: result.confirmationPrompt,
            note: "Nothing has been changed. Present the details and ask the user to confirm.",
          }),
        },
      };
    }

    if (result.requiresApproval) {
      return {
        record: { round, requestedTool: call.name, resolvedToolId: resolved.toolId, status: "APPROVAL_REQUIRED", failureCode: "APPROVAL_REQUIRED", durationMs: Date.now() - t0 },
        message: {
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            status: "APPROVAL_REQUIRED",
            note: "This action needs human approval and has NOT been performed. Say so plainly.",
          }),
        },
      };
    }

    const sanitized = sanitizeToolResult(resolved.toolId, result.result);
    return {
      record: { round, requestedTool: call.name, resolvedToolId: resolved.toolId, status: "EXECUTED", durationMs: Date.now() - t0 },
      message: {
        role: "tool",
        toolCallId: call.id,
        content: renderToolResultForPrompt(resolved.toolId, sanitized),
      },
    };
  } catch (err) {
    // Failures reach the model as failures. The alternative — a silent empty result — is
    // what produces "your booking is confirmed" after a cancellation actually failed.
    const code = err instanceof ToolExecutionError ? err.code : "INTERNAL_ERROR";
    logger.warn("ai_tool_bridge_execution_failed", {
      category: "APPLICATION",
      toolId: resolved.toolId,
      code,
      actorRole: actor.actorRole,
    });
    return {
      record: { round, requestedTool: call.name, resolvedToolId: resolved.toolId, status: "FAILED", failureCode: code, durationMs: Date.now() - t0 },
      message: {
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify({ ok: false, error: code, note: "The action did NOT succeed. Tell the user it failed." }),
      },
    };
  }
}

/**
 * Runs the model↔tool conversation to a finished answer, or to a bounded stop.
 *
 * The loop is capped in rounds and in calls per round. Without both, a model that keeps
 * re-requesting the same tool burns tokens and money until a timeout, and the caller has
 * no way to tell a slow answer from a runaway one.
 */
export async function runToolConversation(input: ToolBridgeInput): Promise<ToolBridgeResult> {
  const discovered = getAvailableAiTools({
    actorRole: input.actor.actorRole as AiGatewayRole,
    intent: input.intent,
    includeWrites: input.allowWrites,
  });
  const allowedToolIds = new Set(discovered.map((t) => t.toolId));
  const schemas = toProviderToolSchemas(discovered);

  const messages: AiMessage[] = [...input.messages];
  const toolCalls: ToolCallRecord[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let last: AiProviderResponse | undefined;
  let loopLimitHit = false;
  let round = 0;

  for (; round < aiToolsConfig.maxToolRounds; round += 1) {
    const response = await input.route({
      systemPrompt: input.systemPrompt,
      messages,
      maxTokens: input.maxTokens,
      // Tools are only offered while rounds remain, so the final turn is always prose.
      tools: schemas.length > 0 ? schemas : undefined,
    });

    last = response;
    promptTokens += response.promptTokens;
    completionTokens += response.completionTokens;
    recordToolBridgeRound(input.actor.actorRole, round + 1);

    const requested = response.toolCalls ?? [];
    if (requested.length === 0) break;

    // Replay the assistant turn verbatim, then answer each call, so the provider can pair
    // results with requests on the next round.
    messages.push({ role: "assistant", content: response.content, toolCalls: requested });

    const capped = requested.slice(0, aiToolsConfig.maxToolCallsPerRound);
    for (const call of capped) {
      const { record, message } = await runOneToolCall({
        call,
        allowedToolIds,
        actor: input.actor,
        round: round + 1,
      });
      toolCalls.push(record);
      messages.push(message);
    }

    if (round + 1 >= aiToolsConfig.maxToolRounds) {
      loopLimitHit = true;
    }
  }

  // A loop that ended on the cap has no final prose. Say so rather than returning the
  // model's last partial thought as if it were an answer.
  const content = loopLimitHit && !last?.content
    ? "I could not complete that request within the allowed number of steps. Nothing was changed."
    : (last?.content ?? "");

  return {
    content,
    provider: last?.provider ?? "NONE",
    model: last?.model ?? "none",
    rounds: round + (loopLimitHit ? 0 : 1),
    toolCalls,
    loopLimitHit,
    promptTokens,
    completionTokens,
  };
}
