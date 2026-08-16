import type { LogLine } from '@lnwjud/ipc-contracts';

export function applyLogSnapshot(
  previous: readonly LogLine[],
  previousIds: ReadonlySet<number>,
  snapshotLines: readonly LogLine[],
): { readonly lines: LogLine[]; readonly ids: Set<number> } {
  const byId = new Map<number, LogLine>();
  for (const line of previous) byId.set(line.id, line);
  for (const line of snapshotLines) {
    if (!byId.has(line.id)) byId.set(line.id, line);
  }
  const ids = new Set(previousIds);
  for (const line of byId.values()) ids.add(line.id);
  const lines = [...byId.values()].sort((left, right) => left.id - right.id);
  return { lines, ids };
}
