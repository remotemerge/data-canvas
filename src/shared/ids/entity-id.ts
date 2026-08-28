/**
 * Stable opaque identifiers for domain entities.
 *
 * Security invariant. This module generates every entity ID and never derives one from a filename,
 * column header, or agent input. Because it is the only source of entity identity, the query
 * compiler can treat a resolved ID as trusted while treating the values around it as untrusted.
 */
export type EntityId = string;

/** Prefixes make IDs self-describing in logs, errors, and agent-facing payloads. */
export const ID_PREFIX = {
  workspace: 'ws',
  dataset: 'ds',
  column: 'col',
  visualization: 'viz',
  filter: 'flt',
  selection: 'sel',
  metric: 'mtr',
  annotation: 'ann',
  action: 'act',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

/**
 * Creates a prefixed, globally unique entity ID, e.g. `ds_3f9c1a2b-...`.
 *
 * Uses `crypto.randomUUID()` rather than a counter so IDs stay unique across reloads and across
 * a persisted workspace being reopened.
 */
export const createEntityId = (prefix: IdPrefix): EntityId => `${prefix}_${crypto.randomUUID()}`;
