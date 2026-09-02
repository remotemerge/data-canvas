import { resolveDataset } from '@/application/validation/validate-entity-refs.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import {
  connectsDatasets,
  MAX_RELATIONSHIP_KEY_COLUMNS,
  relatedDatasetId,
} from '@/domain/relationship/relationship.ts';
import type { Relationship, RelationshipKeyPair, RelationshipKind } from '@/domain/relationship/relationship.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Validate relationship structure before a join can change query results.

// Sample fan-out threshold for `many_to_one` and `one_to_one` relationships.
export const FAN_OUT_RATIO_THRESHOLD = 1.05;

// Number of rows sampled for key-quality warnings.
export const KEY_QUALITY_SAMPLE_ROWS = 10_000;

// Relationship kinds that require a unique right-hand key.
const RIGHT_KEY_MUST_BE_UNIQUE: readonly RelationshipKind[] = ['one_to_one', 'many_to_one'] as const;

export interface RelationshipCandidate {
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  on: RelationshipKeyPair[];
  kind: RelationshipKind;
}

export interface ValidatedRelationship {
  leftDataset: Dataset;
  rightDataset: Dataset;
  // Resolved key columns in caller-declared order.
  keys: { left: Column; right: Column }[];
}

// Maps logical types to the compatibility classes used for join keys.
const joinTypeClass = (type: LogicalType): string => {
  if (isNumericType(type)) {
    return 'number';
  }
  if (isTemporalType(type)) {
    return 'temporal';
  }
  if (isTextType(type)) {
    return 'text';
  }

  return type;
};

const incompatible = (left: Column, right: Column): DomainError =>
  domainError(
    'INCOMPATIBLE_COLUMN',
    `Columns '${left.name}' and '${right.name}' cannot form a join key: their types are '${left.logicalType}' and '${right.logicalType}'.`,
    { leftColumnId: left.id, rightColumnId: right.id },
  );

// Returns whether a new relationship would close a cycle in the relationship graph.
export const wouldCreateCycle = (
  relationships: readonly Relationship[],
  leftDatasetId: EntityId,
  rightDatasetId: EntityId,
): boolean => {
  const visited = new Set<EntityId>([leftDatasetId]);
  const queue: EntityId[] = [leftDatasetId];

  while (queue.length > 0) {
    const current = queue.shift() as EntityId;

    for (const relationship of relationships) {
      const neighbour = relatedDatasetId(relationship, current);

      if (neighbour === undefined || visited.has(neighbour)) {
        continue;
      }
      if (neighbour === rightDatasetId) {
        return true;
      }

      visited.add(neighbour);
      queue.push(neighbour);
    }
  }

  return false;
};

// Resolves each key pair to its columns, requiring both sides to join on the same type class.
const resolveKeyPairs = (
  pairs: RelationshipCandidate['on'],
  leftDataset: Dataset,
  rightDataset: Dataset,
): Result<ValidatedRelationship['keys'], DomainError> => {
  const keys: ValidatedRelationship['keys'] = [];

  for (const pair of pairs) {
    const left = leftDataset.columns.find((column) => column.id === pair.leftColumnId);
    const right = rightDataset.columns.find((column) => column.id === pair.rightColumnId);

    if (left === undefined) {
      return err(
        domainError(
          'COLUMN_NOT_FOUND',
          `No column with id '${pair.leftColumnId}' exists in dataset '${leftDataset.name}'.`,
          {
            datasetId: leftDataset.id,
            columnId: pair.leftColumnId,
          },
        ),
      );
    }

    if (right === undefined) {
      return err(
        domainError(
          'COLUMN_NOT_FOUND',
          `No column with id '${pair.rightColumnId}' exists in dataset '${rightDataset.name}'.`,
          {
            datasetId: rightDataset.id,
            columnId: pair.rightColumnId,
          },
        ),
      );
    }

    if (joinTypeClass(left.logicalType) !== joinTypeClass(right.logicalType)) {
      return err(incompatible(left, right));
    }

    keys.push({ left, right });
  }

  return ok(keys);
};

// Validates relationship structure without reading dataset rows.
export const validateRelationship = (
  workspace: Workspace,
  candidate: RelationshipCandidate,
): Result<ValidatedRelationship, DomainError> => {
  if (candidate.leftDatasetId === candidate.rightDatasetId) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        'A relationship must connect two different datasets; self-joins are not supported.',
        {
          datasetId: candidate.leftDatasetId,
        },
      ),
    );
  }

  const leftDataset = resolveDataset(workspace, candidate.leftDatasetId);
  if (!leftDataset.ok) {
    return leftDataset;
  }

  const rightDataset = resolveDataset(workspace, candidate.rightDatasetId);
  if (!rightDataset.ok) {
    return rightDataset;
  }

  for (const dataset of [leftDataset.value, rightDataset.value]) {
    if (dataset.importStatus !== 'ready') {
      return err(
        domainError('UNSUPPORTED_OPERATION', `Dataset '${dataset.name}' is not ready, so it cannot be related yet.`, {
          datasetId: dataset.id,
          importStatus: dataset.importStatus,
        }),
      );
    }
  }

  if (candidate.on.length === 0 || candidate.on.length > MAX_RELATIONSHIP_KEY_COLUMNS) {
    return err(
      domainError(
        'INVALID_TOOL_ARGUMENTS',
        `A relationship needs between 1 and ${MAX_RELATIONSHIP_KEY_COLUMNS} key column pairs.`,
        { maxKeyColumns: MAX_RELATIONSHIP_KEY_COLUMNS },
      ),
    );
  }

  const resolvedKeys = resolveKeyPairs(candidate.on, leftDataset.value, rightDataset.value);

  if (!resolvedKeys.ok) {
    return resolvedKeys;
  }

  const keys = resolvedKeys.value;
  const relationships = Object.values(workspace.relationships);

  // A second relationship over the same pair would make join-path resolution ambiguous.
  if (relationships.some((existing) => connectsDatasets(existing, leftDataset.value.id, rightDataset.value.id))) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Datasets '${leftDataset.value.name}' and '${rightDataset.value.name}' are already related.`,
        {
          leftDatasetId: leftDataset.value.id,
          rightDatasetId: rightDataset.value.id,
        },
      ),
    );
  }

  if (wouldCreateCycle(relationships, leftDataset.value.id, rightDataset.value.id)) {
    return err(
      domainError(
        'RELATIONSHIP_CYCLE',
        `Relating '${leftDataset.value.name}' to '${rightDataset.value.name}' would create a cycle, which makes join paths ambiguous. Remove an existing relationship first.`,
        { leftDatasetId: leftDataset.value.id, rightDatasetId: rightDataset.value.id },
      ),
    );
  }

  return ok({ leftDataset: leftDataset.value, rightDataset: rightDataset.value, keys });
};

export interface KeyQualityMeasurement {
  // Sampled right-hand rows per distinct key; 1 means unique in the sample.
  rowsPerKey: number;
  sampledRows: number;
  distinctKeys: number;
}

// Converts sampled key quality into a warning for relationships that require unique keys.
export const describeFanOutRisk = (kind: RelationshipKind, measurement: KeyQualityMeasurement): string | undefined => {
  if (!RIGHT_KEY_MUST_BE_UNIQUE.includes(kind)) {
    return undefined;
  }
  if (measurement.distinctKeys === 0) {
    return undefined;
  }
  if (measurement.rowsPerKey <= FAN_OUT_RATIO_THRESHOLD) {
    return undefined;
  }

  return `Declared '${kind}', but the right key has about ${measurement.rowsPerKey.toFixed(2)} rows per value across ${measurement.sampledRows.toLocaleString()} sampled rows. Joined results may fan out and inflate sums.`;
};
