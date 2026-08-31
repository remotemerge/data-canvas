import type { EntityId } from '@/shared/ids/entity-id.ts';

// Declared match cardinality for each side of a join key.
export type RelationshipKind = 'one_to_one' | 'one_to_many' | 'many_to_one';

// Supported join types.
export type JoinKind = 'inner' | 'left';

export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = ['one_to_one', 'one_to_many', 'many_to_one'] as const;

export const JOIN_KINDS: readonly JoinKind[] = ['inner', 'left'] as const;

// Maximum columns in a composite join key.
export const MAX_RELATIONSHIP_KEY_COLUMNS = 4;

export interface RelationshipKeyPair {
  leftColumnId: EntityId;
  rightColumnId: EntityId;
}

// Governed join between two datasets.
export interface Relationship {
  id: EntityId;
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  // Column pairs forming the join key.
  on: RelationshipKeyPair[];
  kind: RelationshipKind;
  join: JoinKind;
  createdBy: 'human' | 'agent' | 'system';
}

// Returns the dataset on the opposite side, if any.
export const relatedDatasetId = (relationship: Relationship, datasetId: EntityId): EntityId | undefined => {
  if (relationship.leftDatasetId === datasetId) return relationship.rightDatasetId;
  if (relationship.rightDatasetId === datasetId) return relationship.leftDatasetId;

  return undefined;
};

// Returns whether a relationship connects this unordered dataset pair.
export const connectsDatasets = (relationship: Relationship, a: EntityId, b: EntityId): boolean =>
  (relationship.leftDatasetId === a && relationship.rightDatasetId === b) ||
  (relationship.leftDatasetId === b && relationship.rightDatasetId === a);
