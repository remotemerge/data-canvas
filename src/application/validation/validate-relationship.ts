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

/*
 * Relationship validation.
 *
 * Stricter than the other validators on purpose. A malformed filter returns no rows; a malformed
 * join returns rows that look right and are not — it can multiply a `sum` without any visible
 * symptom. Everything that can be decided before the relationship exists is decided here.
 */

/** Above this many right-hand rows per key value, a `many_to_one` or `one_to_one` claim fans out. */
export const FAN_OUT_RATIO_THRESHOLD = 1.05;

/** Rows sampled when measuring key uniqueness. Bounded so creation stays interactive on large data. */
export const KEY_QUALITY_SAMPLE_ROWS = 10_000;

/** Kinds asserting that the right-hand key identifies at most one row. */
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
  /** Resolved key columns, in the order the caller declared them. */
  keys: { left: Column; right: Column }[];
}

/**
 * Collapses the logical type vocabulary to the classes a join key may match across.
 *
 * Types are compared by class rather than by identity so a `category` key can join a `string` key —
 * the same values, differently classified by cardinality — while a number-to-text join is still
 * rejected. `boolean` and `unknown` fall into their own classes, which makes them joinable only to
 * themselves.
 */
const joinTypeClass = (type: LogicalType): string => {
  if (isNumericType(type)) return 'number';
  if (isTemporalType(type)) return 'temporal';
  if (isTextType(type)) return 'text';

  return type;
};

const incompatible = (left: Column, right: Column): DomainError =>
  domainError(
    'INCOMPATIBLE_COLUMN',
    `Columns '${left.name}' and '${right.name}' cannot form a join key: their types are '${left.logicalType}' and '${right.logicalType}'.`,
    { leftColumnId: left.id, rightColumnId: right.id },
  );

/**
 * Detects whether adding an edge between two datasets would close a cycle.
 *
 * A cycle makes join-path resolution non-deterministic — two different paths would connect the same
 * pair of datasets and produce different numbers — so it is rejected at creation rather than
 * disambiguated at query time. Because existing relationships are already acyclic, the new edge
 * closes a cycle exactly when its endpoints are already connected.
 */
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

      if (neighbour === undefined || visited.has(neighbour)) continue;
      if (neighbour === rightDatasetId) return true;

      visited.add(neighbour);
      queue.push(neighbour);
    }
  }

  return false;
};

/**
 * Validates everything decidable without reading data.
 *
 * The key-quality measurement is deliberately separate: it needs the engine, and every check here
 * must be able to run in a plain unit test and inside a handler that has already failed fast.
 */
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
  if (!leftDataset.ok) return leftDataset;

  const rightDataset = resolveDataset(workspace, candidate.rightDatasetId);
  if (!rightDataset.ok) return rightDataset;

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

  const keys: ValidatedRelationship['keys'] = [];

  for (const pair of candidate.on) {
    const left = leftDataset.value.columns.find((column) => column.id === pair.leftColumnId);
    const right = rightDataset.value.columns.find((column) => column.id === pair.rightColumnId);

    if (left === undefined) {
      return err(
        domainError(
          'COLUMN_NOT_FOUND',
          `No column with id '${pair.leftColumnId}' exists in dataset '${leftDataset.value.name}'.`,
          {
            datasetId: leftDataset.value.id,
            columnId: pair.leftColumnId,
          },
        ),
      );
    }

    if (right === undefined) {
      return err(
        domainError(
          'COLUMN_NOT_FOUND',
          `No column with id '${pair.rightColumnId}' exists in dataset '${rightDataset.value.name}'.`,
          {
            datasetId: rightDataset.value.id,
            columnId: pair.rightColumnId,
          },
        ),
      );
    }

    if (joinTypeClass(left.logicalType) !== joinTypeClass(right.logicalType)) return err(incompatible(left, right));

    keys.push({ left, right });
  }

  const relationships = Object.values(workspace.relationships);

  // A second relationship over the same pair would make the join path ambiguous, which is the same
  // correctness hazard as a cycle rather than a richer way to express a join.
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
  /** Sampled right-hand rows per distinct key value. 1 means the key is unique in the sample. */
  rowsPerKey: number;
  sampledRows: number;
  distinctKeys: number;
}

/**
 * Turns a key-quality measurement into a warning, or `undefined` when the declared kind holds.
 *
 * A warning rather than a rejection: the sample is bounded, so it can only ever be evidence. A hard
 * refusal on sampled evidence would block legitimate joins on data the sample happened to miss.
 * The measurement is stated numerically so the user can judge it rather than trust a verdict.
 */
export const describeFanOutRisk = (kind: RelationshipKind, measurement: KeyQualityMeasurement): string | undefined => {
  if (!RIGHT_KEY_MUST_BE_UNIQUE.includes(kind)) return undefined;
  if (measurement.distinctKeys === 0) return undefined;
  if (measurement.rowsPerKey <= FAN_OUT_RATIO_THRESHOLD) return undefined;

  return `Declared '${kind}', but the right key has about ${measurement.rowsPerKey.toFixed(2)} rows per value across ${measurement.sampledRows.toLocaleString()} sampled rows. Joined results may fan out and inflate sums.`;
};
