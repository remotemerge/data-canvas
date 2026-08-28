import type { FilterExpression } from '@/domain/filter/filter.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

/**
 * A highlighted set of records.
 *
 * `mode: 'predicate'` exists so a selection like "all rows in Q4" never has to materialize millions
 * of row keys in JavaScript state. Prefer predicate mode for anything derived from a chart axis,
 * range brush, or category click.
 */
export interface Selection {
  id: EntityId;
  datasetId: EntityId;
  mode: 'keys' | 'predicate';
  keys?: string[];
  predicate?: FilterExpression;
  origin: 'table' | 'chart' | 'agent';
}
