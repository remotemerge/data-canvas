import { connectsDatasets } from '@/domain/relationship/relationship.ts';
import type { RelationshipKind } from '@/domain/relationship/relationship.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/*
 * Candidate relationship discovery.
 *
 * Manual join definition is where users give up, so the application proposes candidates by matching
 * column names and types across datasets. Every result is a proposal: nothing here creates a
 * relationship. A wrong automatic join silently corrupts every number downstream of it, which is a
 * far worse outcome than asking for one click.
 */

/** Cap on returned proposals, so a workspace with many datasets cannot produce an unbounded list. */
export const MAX_SUGGESTIONS = 20;

export interface RelationshipSuggestion {
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  leftColumnId: EntityId;
  rightColumnId: EntityId;
  /** Display names, so a caller can explain the proposal without re-resolving the columns. */
  leftColumnName: string;
  rightColumnName: string;
  kind: RelationshipKind;
  /** 0-1. Ranks proposals; it is not a correctness claim about the data. */
  confidence: number;
  /** Why this pair was proposed, in words a user can judge. */
  reason: string;
}

const joinTypeClass = (type: LogicalType): string => {
  if (isNumericType(type)) return 'number';
  if (isTemporalType(type)) return 'temporal';
  if (isTextType(type)) return 'text';

  return type;
};

/** Normalizes a name for comparison: case, spaces, and separators carry no meaning here. */
const normalize = (name: string): string => name.toLowerCase().replaceAll(/[\s_-]+/gu, '');

/** Strips a trailing `id`, so `customer_id` and `customer` compare equal. */
const withoutIdSuffix = (name: string): string => (name.endsWith('id') ? name.slice(0, -2) : name);

/** Strips a trailing plural `s`, so a `customers` dataset matches a `customer_id` column. */
const singular = (name: string): string => (name.endsWith('s') ? name.slice(0, -1) : name);

/**
 * Scores one candidate column pair.
 *
 * The three patterns are ranked by how specific the evidence is. An exact name match on a key-shaped
 * column is the strongest; matching a foreign key against the other dataset's own name is next; a
 * bare identical name is weakest because two datasets can share a `name` column meaning nothing.
 * Returns `undefined` when nothing connects the pair.
 */
const scorePair = (
  left: Column,
  right: Column,
  rightDatasetName: string,
): { confidence: number; reason: string } | undefined => {
  if (joinTypeClass(left.logicalType) !== joinTypeClass(right.logicalType)) return undefined;

  const leftName = normalize(left.name);
  const rightName = normalize(right.name);
  const looksLikeKey = leftName.endsWith('id') || rightName.endsWith('id');

  if (leftName === rightName) {
    return looksLikeKey
      ? { confidence: 0.9, reason: `Both datasets have a key column named '${left.name}'.` }
      : { confidence: 0.4, reason: `Both datasets have a column named '${left.name}'.` };
  }

  // The `orders.customer_id` → `customers.id` shape: a foreign key naming the dataset it points at.
  const target = singular(normalize(rightDatasetName));

  if (rightName === 'id' && withoutIdSuffix(leftName) === target) {
    return {
      confidence: 0.85,
      reason: `'${left.name}' names the '${rightDatasetName}' dataset, whose key is '${right.name}'.`,
    };
  }

  if (withoutIdSuffix(leftName) === withoutIdSuffix(rightName) && looksLikeKey) {
    return { confidence: 0.6, reason: `'${left.name}' and '${right.name}' name the same key.` };
  }

  return undefined;
};

/**
 * Proposes relationships between datasets that are not related yet.
 *
 * Pairs are considered in both directions, because which dataset holds the foreign key determines
 * the proposal's shape: the side carrying `customer_id` is the many side. Datasets that are already
 * related are skipped — a second relationship over the same pair is rejected by validation anyway.
 *
 * Value overlap is not measured here. Verifying that keys actually intersect requires the data
 * engine; callers that can reach it confirm a proposal before offering it, and this function stays
 * a pure, testable ranking over schema alone.
 */
export const suggestRelationships = (workspace: Workspace): RelationshipSuggestion[] => {
  const datasets = Object.values(workspace.datasets).filter((dataset) => dataset.importStatus === 'ready');
  const relationships = Object.values(workspace.relationships);
  const suggestions: RelationshipSuggestion[] = [];

  for (const left of datasets) {
    for (const right of datasets) {
      if (left.id === right.id) continue;
      if (relationships.some((existing) => connectsDatasets(existing, left.id, right.id))) continue;

      for (const leftColumn of left.columns) {
        for (const rightColumn of right.columns) {
          const scored = scorePair(leftColumn, rightColumn, right.name);

          if (scored === undefined) continue;

          suggestions.push({
            leftDatasetId: left.id,
            rightDatasetId: right.id,
            leftColumnId: leftColumn.id,
            rightColumnId: rightColumn.id,
            leftColumnName: leftColumn.name,
            rightColumnName: rightColumn.name,
            // The right side is proposed as the lookup: a suggestion points from the dataset
            // holding the foreign key to the one holding the identity it references.
            kind: 'many_to_one',
            confidence: scored.confidence,
            reason: scored.reason,
          });
        }
      }
    }
  }

  return dedupe(suggestions).slice(0, MAX_SUGGESTIONS);
};

/**
 * Keeps the strongest proposal per dataset pair.
 *
 * Without this a wide schema produces many weak variants of the same join, which buries the one
 * proposal worth acting on.
 */
const dedupe = (suggestions: readonly RelationshipSuggestion[]): RelationshipSuggestion[] => {
  const best = new Map<string, RelationshipSuggestion>();

  for (const suggestion of suggestions) {
    // Unordered pair key: `a→b` and `b→a` are the same proposed relationship seen from either end.
    const key = [suggestion.leftDatasetId, suggestion.rightDatasetId].toSorted().join('|');
    const current = best.get(key);

    if (current === undefined || suggestion.confidence > current.confidence) best.set(key, suggestion);
  }

  return [...best.values()].toSorted((a, b) => b.confidence - a.confidence);
};

/** Resolves a dataset's display name for a suggestion, for callers building user-facing text. */
export const suggestionDatasetNames = (
  workspace: Workspace,
  suggestion: RelationshipSuggestion,
): { left: string; right: string } => ({
  left: (workspace.datasets[suggestion.leftDatasetId] as Dataset | undefined)?.name ?? suggestion.leftDatasetId,
  right: (workspace.datasets[suggestion.rightDatasetId] as Dataset | undefined)?.name ?? suggestion.rightDatasetId,
});
