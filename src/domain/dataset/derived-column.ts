import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export const MAX_DERIVED_COLUMN_NAME_LENGTH = 80;

// Column computed from an expression tree at query time.
export interface DerivedColumn {
  id: EntityId;
  // Dataset this column attaches to.
  datasetId: EntityId;
  // Display label; never used to build a SQL identifier.
  name: string;
  expression: DerivedExpression;
  logicalType: LogicalType;
  // Whether the engine has confirmed the inferred logical type.
  typeVerified: boolean;
  createdBy: 'human' | 'agent' | 'system';
}

// Derived IDs use the column prefix so bindings treat them like physical columns.
export const isDerivedColumnId = (columnId: EntityId, derived: Record<EntityId, DerivedColumn>): boolean =>
  Object.hasOwn(derived, columnId);
