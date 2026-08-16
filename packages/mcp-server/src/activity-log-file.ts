import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActivitySink, ActivitySinkEvent } from './activity-tracker.js';

export function mcpActivityLogPath(dataPath: string): string {
  return path.join(dataPath, 'mcp-activity.log');
}

export function formatActivityLogLine(event: ActivitySinkEvent): string {
  return `${JSON.stringify({
    callId: event.callId,
    toolName: event.toolName,
    phase: event.phase,
    resultCode: event.resultCode,
    durationMs: event.durationMs,
    timestamp: event.timestamp,
    ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }),
    ...(event.targetSummary === undefined ? {} : { targetSummary: event.targetSummary }),
    ...(event.resultMessage === undefined ? {} : { resultMessage: event.resultMessage }),
  })}\n`;
}

export function createFileActivitySink(filePath: string): ActivitySink {
  return {
    async record(event: ActivitySinkEvent): Promise<void> {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, formatActivityLogLine(event), 'utf8');
    },
  };
}

export function composeActivitySinks(sinks: readonly ActivitySink[]): ActivitySink {
  return {
    async record(event: ActivitySinkEvent): Promise<void> {
      for (const sink of sinks) {
        await sink.record(event);
      }
    },
  };
}
