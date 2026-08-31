// Stable opaque IDs for domain entities.
export type EntityId = string;

// Entity prefixes used in IDs and agent-facing payloads.
export const ID_PREFIX = {
  workspace: 'ws',
  dataset: 'ds',
  column: 'col',
  visualization: 'viz',
  filter: 'flt',
  selection: 'sel',
  metric: 'mtr',
  annotation: 'ann',
  relationship: 'rel',
  action: 'act',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

// Creates a prefixed globally unique entity ID.
export const createEntityId = (prefix: IdPrefix): EntityId => `${prefix}_${crypto.randomUUID()}`;
