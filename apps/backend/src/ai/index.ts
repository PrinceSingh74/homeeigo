export { invokeAiGateway, getAiHealth, AiGatewayError, AI_ERROR_STATUS } from "./gateway/ai-gateway";
export type { GatewayInvokeOptions } from "./gateway/ai-gateway";
export {
  routeModelRequest,
  getCircuitStates,
  resetCircuits,
  describeProviderChain,
  RouterDeadlineError,
  RouterExhaustedError,
} from "./router/model-router";
export { ProviderError } from "./providers/provider-errors";
export type { ProviderErrorCode } from "./providers/provider-errors";
export { providerHealth, describeChain } from "./router/provider-registry";
export type { ProviderHealthState } from "./router/provider-registry";
export { seedPromptTemplates, listBuiltinTemplates, getTemplate } from "./templates/prompt-templates";
export {
  aiConfig,
  isAnthropicConfigured,
  isAnyProviderConfigured,
  isGeminiConfigured,
  isGroqConfigured,
  isOpenAiConfigured,
  isProviderConfigured,
  providerModel,
} from "./config";
export type {
  AiGatewayInput,
  AiGatewayResult,
  AiActorContext,
  AiGatewayRole as AiRole,
} from "./types";
