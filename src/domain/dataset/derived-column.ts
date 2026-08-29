import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export const MAX_DERIVED_COLUMN_NAME_LENGTH = 80;

/**
 * A column computed from other columns rather than read from the imported file.
 *
 * A derived column compiles to a SQL expression injected into the queries that reference it, not to
 * a materialized table. Materializing would duplicate storage and would need invalidating on every
 * change to the base dataset, and DuckDB evaluates these expressions cheaply enough that the copy
 * buys nothing.
 *
 * `logicalType` is inferred from the expression when the column is created, then corrected against
 * the type DuckDB actually returns on first execution. Inference is a prediction; the engine decides.
 */
export interface DerivedColumn {
  id: EntityId;
  /** The dataset this column attaches to. Every referenced column must be reachable from it. */
  datasetId: EntityId;
  /** Display label, rendered as plain text and never used to build a SQL identifier. */
  name: string;
  expression: DerivedExpression;
  logicalType: LogicalType;
  /** True once DuckDB's own result type has confirmed or replaced the inferred type. */
  typeVerified: boolean;
  createdBy: 'human' | 'agent' | 'system';
}

/** Derived column IDs carry the same `col_` prefix as physical ones, so a binding treats them alike. */
export const isDerivedColumnId = (columnId: EntityId, derived: Record<EntityId, DerivedColumn>): boolean =>
  Object.hasOwn(derived, columnId);
