import type { HomigoEvent } from "./homigo-event";

export type EventConsumerHandler = (event: HomigoEvent) => Promise<void>;

export type RegisteredConsumer = {
  name: string;
  eventTypes: string[] | "*";
  handler: EventConsumerHandler;
  maxAttempts: number;
};

const consumers: RegisteredConsumer[] = [];

export function registerConsumer(consumer: RegisteredConsumer): void {
  if (consumers.some((c) => c.name === consumer.name)) {
    throw new Error(`Consumer already registered: ${consumer.name}`);
  }
  consumers.push(consumer);
}

export function getRegisteredConsumers(): readonly RegisteredConsumer[] {
  return consumers;
}

export function matchConsumers(eventType: string): RegisteredConsumer[] {
  return consumers.filter((c) => c.eventTypes === "*" || c.eventTypes.includes(eventType));
}

export function clearConsumersForTests(): void {
  consumers.length = 0;
}
