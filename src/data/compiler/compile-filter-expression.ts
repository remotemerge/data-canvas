import { MAX_FILTER_VALUE_LIST_LENGTH, validateFilter } from '@/application/validation/validate-filter.ts';
import { quoteIdentifier } from '@/data/duckdb/identifier-safety.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import type { FilterExpression, FilterOperator } from '@/domain/filter/filter.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface CompiledFilter {
  sql: string;
  parameters: unknown[];
}

/**
 * Resolves a column ID to the SQL reference for it.
 *
 * Injected rather than derived here, because in a joined query the same physical name can exist on
 * more than one relation and the reference must carry the compiler's generated table alias. The
 * function returns `undefined` for an unknown column so the caller reports it uniformly.
 */
export type ColumnReferenceResolver = (columnId: EntityId) => { sql: string; column: Column } | undefined;

/** The reference resolver for a query over a single, unaliased relation. */
export const unqualifiedColumnReference =
  (columns: readonly Column[]): ColumnReferenceResolver =>
  (columnId) => {
    const column = columns.find((candidate) => candidate.id === columnId);

    return column === undefined ? undefined : { sql: quoteIdentifier(column.physicalName), column };
  };

const SQL_OPERATOR: Readonly<Partial<Record<FilterOperator, string>>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const missingColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', 'The filter references a column that does not exist in this dataset.', { columnId });

/**
 * Compiles a filter tree to a parameterized `WHERE` fragment.
 *
 * `reference` accepts a plain column list for a single-relation query, or a resolver when the query
 * spans a join and each identifier must carry its table alias. Values are always bound parameters;
 * this function has no path that interpolates one into SQL.
 */
export const compileFilterExpression = (
  expression: FilterExpression,
  reference: readonly Column[] | ColumnReferenceResolver,
): Result<CompiledFilter, DomainError> => {
  const resolve: ColumnReferenceResolver =
    typeof reference === 'function' ? reference : unqualifiedColumnReference(reference);

  if (expression.kind === 'not') {
    const operand = compileFilterExpression(expression.operand, resolve);
    return operand.ok ? ok({ sql: `NOT (${operand.value.sql})`, parameters: operand.value.parameters }) : operand;
  }

  if (expression.kind === 'and' || expression.kind === 'or') {
    if (expression.operands.length === 0) {
      return err(domainError('INVALID_TOOL_ARGUMENTS', `A ${expression.kind} filter must contain an operand.`));
    }

    const fragments: string[] = [];
    const parameters: unknown[] = [];
    for (const operand of expression.operands) {
      const compiled = compileFilterExpression(operand, resolve);
      if (!compiled.ok) return compiled;
      fragments.push(`(${compiled.value.sql})`);
      parameters.push(...compiled.value.parameters);
    }
    return ok({ sql: fragments.join(expression.kind === 'and' ? ' AND ' : ' OR '), parameters });
  }

  const resolved = resolve(expression.columnId);
  if (resolved === undefined) return err(missingColumn(expression.columnId));

  const { column, sql: identifier } = resolved;

  const valid = validateFilter(column, expression.operator, expression.value);
  if (!valid.ok) return valid;

  const operator = SQL_OPERATOR[expression.operator];
  if (operator !== undefined) return ok({ sql: `${identifier} ${operator} ?`, parameters: [expression.value] });

  switch (expression.operator) {
    case 'between': {
      const values = expression.value as [unknown, unknown];
      return ok({ sql: `${identifier} BETWEEN ? AND ?`, parameters: values });
    }
    case 'in':
    case 'not_in': {
      const values = expression.value as unknown[];
      if (values.length > MAX_FILTER_VALUE_LIST_LENGTH) {
        return err(domainError('RESULT_LIMIT_EXCEEDED', 'The filter contains too many values.'));
      }
      const placeholders = values.map(() => '?').join(', ');
      return ok({
        sql: `${identifier} ${expression.operator === 'not_in' ? 'NOT IN' : 'IN'} (${placeholders})`,
        parameters: values,
      });
    }
    case 'contains':
      return ok({ sql: `contains(${identifier}, ?)`, parameters: [expression.value] });
    case 'is_null':
      return ok({ sql: `${identifier} IS NULL`, parameters: [] });
    case 'is_not_null':
      return ok({ sql: `${identifier} IS NOT NULL`, parameters: [] });
    default:
      return err(domainError('UNSUPPORTED_OPERATION', 'That filter operator is not supported.'));
  }
};
