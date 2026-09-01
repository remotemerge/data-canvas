import { connectsDatasets } from '@/domain/relationship/relationship.ts';
import type { RelationshipKind } from '@/domain/relationship/relationship.ts';
import type { Column, Dataset } from '@/domain/dataset/dataset.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Schema-only relationship suggestions. This module never creates a relationship.

// Maximum number of relationship suggestions returned.
export const MAX_SUGGESTIONS = 20;

export interface RelationshipSuggestion {
  leftDatasetId: EntityId;
  rightDatasetId: EntityId;
  leftColumnId: EntityId;
  rightColumnId: EntityId;
  // Column display names included in the suggestion.
  leftColumnName: string;
  rightColumnName: string;
  kind: RelationshipKind;
  // Score from 0 to 1; it ranks proposals but does not verify the data.
  confidence: number;
  // Human-readable reason for the proposal.
  reason: string;
}

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

// Normalizes a name for comparison.
const normalize = (name: string): string => name.toLowerCase().replaceAll(/[\s_-]+/gu, '');

// Removes a trailing `id` for key-name comparison.
const withoutIdSuffix = (name: string): string => (name.endsWith('id') ? name.slice(0, -2) : name);

// Removes a trailing plural `s` for dataset-name comparison.
const singular = (name: string): string => (name.endsWith('s') ? name.slice(0, -1) : name);

// Scores a compatible column pair from schema names and key shape.
const scorePair = (
  left: Column,
  right: Column,
  rightDatasetName: string,
): { confidence: number; reason: string } | undefined => {
  if (joinTypeClass(left.logicalType) !== joinTypeClass(right.logicalType)) {
    return undefined;
  }

  const leftName = normalize(left.name);
  const rightName = normalize(right.name);
  const looksLikeKey = leftName.endsWith('id') || rightName.endsWith('id');

  if (leftName === rightName) {
    return looksLikeKey
      ? { confidence: 0.9, reason: `Both datasets have a key column named '${left.name}'.` }
      : { confidence: 0.4, reason: `Both datasets have a column named '${left.name}'.` };
  }

  // A foreign key can name the dataset it points to, as in `orders.customer_id` → `customers.id`.
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

// Proposes unconnected dataset pairs from schema names and types.
export const suggestRelationships = (workspace: Workspace): RelationshipSuggestion[] => {
  const datasets = Object.values(workspace.datasets).filter((dataset) => dataset.importStatus === 'ready');
  const relationships = Object.values(workspace.relationships);
  const suggestions: RelationshipSuggestion[] = [];

  for (const left of datasets) {
    for (const right of datasets) {
      if (left.id === right.id) {
        continue;
      }
      if (relationships.some((existing) => connectsDatasets(existing, left.id, right.id))) {
        continue;
      }

      for (const leftColumn of left.columns) {
        for (const rightColumn of right.columns) {
          const scored = scorePair(leftColumn, rightColumn, right.name);

          if (scored === undefined) {
            continue;
          }

          suggestions.push({
            leftDatasetId: left.id,
            rightDatasetId: right.id,
            leftColumnId: leftColumn.id,
            rightColumnId: rightColumn.id,
            leftColumnName: leftColumn.name,
            rightColumnName: rightColumn.name,
            // Point from the foreign-key dataset to the lookup dataset.
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

// Keeps the strongest proposal for each unordered dataset pair.
const dedupe = (suggestions: readonly RelationshipSuggestion[]): RelationshipSuggestion[] => {
  const best = new Map<string, RelationshipSuggestion>();

  for (const suggestion of suggestions) {
    // Treat both directions of a dataset pair as the same proposal.
    const key = [suggestion.leftDatasetId, suggestion.rightDatasetId].toSorted().join('|');
    const current = best.get(key);

    if (current === undefined || suggestion.confidence > current.confidence) {
      best.set(key, suggestion);
    }
  }

  return [...best.values()].toSorted((a, b) => b.confidence - a.confidence);
};

// Resolves display names for a relationship suggestion.
export const suggestionDatasetNames = (
  workspace: Workspace,
  suggestion: RelationshipSuggestion,
): { left: string; right: string } => ({
  left: (workspace.datasets[suggestion.leftDatasetId] as Dataset | undefined)?.name ?? suggestion.leftDatasetId,
  right: (workspace.datasets[suggestion.rightDatasetId] as Dataset | undefined)?.name ?? suggestion.rightDatasetId,
});
