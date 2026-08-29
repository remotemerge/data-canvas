import type { Workspace } from '@/domain/workspace/workspace.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const serializeEntity = (value: unknown): string => JSON.stringify(value);

export const deserializeEntity = (payload: string): unknown => JSON.parse(payload) as unknown;

export const isWorkspacePayload = (value: unknown): value is Workspace => {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    Number.isSafeInteger(value['schemaVersion']) &&
    Number.isSafeInteger(value['revision']) &&
    typeof value['name'] === 'string' &&
    isRecord(value['datasets']) &&
    isRecord(value['relationships']) &&
    isRecord(value['visualizations']) &&
    isRecord(value['filters']) &&
    isRecord(value['tableSorts']) &&
    isRecord(value['selections']) &&
    isRecord(value['metrics']) &&
    isRecord(value['annotations']) &&
    isRecord(value['layout']) &&
    Array.isArray(value['layout']['items']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
};
