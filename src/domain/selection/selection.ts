import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

// Selection represented by explicit keys or a predicate.
export interface Selection {
  id: EntityId;
  datasetId: EntityId;
  mode: 'keys' | 'predicate';
  keys?: string[];
  predicate?: FilterExpression;
  origin: 'table' | 'chart' | 'agent';
}
