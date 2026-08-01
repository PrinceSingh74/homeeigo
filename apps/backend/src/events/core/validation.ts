import { isHomigoEvent, type HomigoEvent } from "./homigo-event";
import { eventPlatformConfig } from "./config";

export function validateEventEnvelope(payload: unknown): HomigoEvent {
  if (!isHomigoEvent(payload)) {
    throw new Error("Invalid Homigo event envelope");
  }
  if (!payload.type.startsWith("homigo.")) {
    throw new Error(`Invalid event type namespace: ${payload.type}`);
  }
  if (!payload.homigo.aggregateType || !payload.homigo.aggregateId) {
    throw new Error("Event missing aggregate identity");
  }
  if (!payload.homigo.version) {
    throw new Error("Event missing version");
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > eventPlatformConfig.maxPayloadBytes) {
    throw new Error("Event payload exceeds max size");
  }
  return payload;
}
