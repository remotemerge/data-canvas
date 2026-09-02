/*
 * Stable opaque IDs for domain entities. The alias carries domain meaning that a bare `string` loses,
 * so it is kept rather than inlined. Branding it instead would change every `Record<EntityId, T>` key
 * across the domain, which is a deliberate architectural decision and not a naming cleanup.
 */
export type EntityId = string; // NOSONAR

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
