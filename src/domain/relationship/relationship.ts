import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * How many rows on each side a join key matches.
 *
 * Declared rather than inferred, because the truth depends on data the user may not have imported
 * yet. The declaration is checked against a sample at creation time, so a wrong claim surfaces as a
 * measured warning rather than as a silently multiplied `sum`.
 */
export type RelationshipKind = 'one_to_one' | 'one_to_many' | 'many_to_one';

/**
 * Only `inner` and `left`.
 *
 * `right`, `full`, and `cross` are excluded deliberately: they multiply both the correctness surface
 * and the ways a query can explode in cardinality, without covering an analytical case this product
 * serves. A `right` join is a `left` join with the datasets swapped, which the relationship already
 * expresses.
 */
export type JoinKind = 'inner' | 'left';

export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = ['one_to_one', 'one_to_many', 'many_to_one'] as const;

export const JOIN_KINDS: readonly JoinKind[] = ['inner', 'left'] as const;

/** Composite keys wider than this are out of scope; the bound keeps join-path cost predictable. */
export const MAX_RELATIONSHIP_KEY_COLUMNS = 4;

export interface RelationshipKeyPair {
  leftColumnId: EntityId;
  rightColumnId: EntityId;
}

/**
 * A governed join between two datasets.
 *
 * Carries no SQL. The compiler turns this into a `JOIN` clause with its own generated aliases, which
 * is what keeps a relationship from becoming a place where agent input reaches the database as text.
 */
export interface Relationship {
  id: EntityId;
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  /** Column pairs forming the join key. Bounded by `MAX_RELATIONSHIP_KEY_COLUMNS`. */
  on: RelationshipKeyPair[];
  kind: RelationshipKind;
  join: JoinKind;
  createdBy: 'human' | 'agent' | 'system';
}

/**
 * Returns the dataset on the other side of a relationship, or `undefined` when the relationship does
 * not touch the given dataset.
 *
 * Relationships are traversed in both directions during join-path resolution, so the direction a
 * user happened to declare must not determine which datasets are reachable.
 */
export const relatedDatasetId = (relationship: Relationship, datasetId: EntityId): EntityId | undefined => {
  if (relationship.leftDatasetId === datasetId) return relationship.rightDatasetId;
  if (relationship.rightDatasetId === datasetId) return relationship.leftDatasetId;

  return undefined;
};

/** True when the relationship connects exactly this unordered pair of datasets. */
export const connectsDatasets = (relationship: Relationship, a: EntityId, b: EntityId): boolean =>
  (relationship.leftDatasetId === a && relationship.rightDatasetId === b) ||
  (relationship.leftDatasetId === b && relationship.rightDatasetId === a);
