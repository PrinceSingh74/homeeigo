import type { EtlRunMode } from "@prisma/client";

export type EtlJobContext = {
  jobId: string;
  runMode: EtlRunMode;
  traceId: string;
  correlationId: string;
  batchSize: number;
  timeoutMs: number;
  lowWatermark: Date | null;
  highWatermark: Date | null;
  cursorId: string | null;
  executionId: string;
};

export type EtlJobResult = {
  rowsExtracted: number;
  rowsLoaded: number;
  lowWatermark: Date | null;
  highWatermark: Date | null;
  cursorEnd: string | null;
  metadata?: Record<string, unknown>;
};

export type EtlJobHandler = (ctx: EtlJobContext) => Promise<EtlJobResult>;

export type EtlJobRegistry = Record<string, EtlJobHandler>;
