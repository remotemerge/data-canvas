import { compileBinStrategy } from '@/data/compiler/compile-bin-strategy.ts';
import type { ColumnReferenceResolver } from '@/data/compiler/compile-filter-expression.ts';
import type { ColumnRange } from '@/domain/analysis/bin-strategy.ts';
import type {
  ArithmeticOperator,
  CastTarget,
  ComparisonOperator,
  DatePart,
  DerivedExpression,
} from '@/domain/analysis/derived-expression.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

export interface CompiledExpression {
  sql: string;
  parameters: unknown[];
}

// Allowlisted SQL operators; domain values are looked up here, not interpolated.
const ARITHMETIC_SQL: Readonly<Record<ArithmeticOperator, string>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
};

const COMPARISON_SQL: Readonly<Record<ComparisonOperator, string>> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

// Maps domain date-part names to DuckDB names.
const DATE_PART_SQL: Readonly<Record<DatePart, string>> = {
  year: 'year',
  quarter: 'quarter',
  month: 'month',
  week: 'week',
  day: 'day',
  hour: 'hour',
  dayOfWeek: 'dow',
};

const CAST_SQL: Readonly<Record<CastTarget, string>> = {
  number: 'DOUBLE',
  string: 'VARCHAR',
  date: 'TIMESTAMP',
};

// Ranges for expression-level binning, keyed by column ID.
export type ColumnRangeLookup = (columnId: EntityId) => ColumnRange | undefined;

export interface DerivedCompilerContext {
  resolve: ColumnReferenceResolver;
  // Derived-column definitions available to references.
  derivedColumns: Record<EntityId, DerivedColumn>;
  rangeFor?: ColumnRangeLookup;
}

const missingColumn = (columnId: EntityId): DomainError =>
  domainError('COLUMN_NOT_FOUND', 'The expression references a column that does not exist.', { columnId });

// Compiles a derived-expression tree to a parameterized SQL fragment.
export const compileDerivedExpression = (
  expression: DerivedExpression,
  context: DerivedCompilerContext,
  depth = 0,
): Result<CompiledExpression, DomainError> => {
  if (depth > 32) {
    return err(domainError('UNSUPPORTED_OPERATION', 'The derived expression nests too deeply to compile.'));
  }

  switch (expression.kind) {
    case 'column': {
      // Inline derived definitions because sibling SELECT aliases are not valid in GROUP BY.
      const derived = context.derivedColumns[expression.columnId];

      if (derived !== undefined) return compileDerivedExpression(derived.expression, context, depth + 1);

      const resolved = context.resolve(expression.columnId);

      return resolved === undefined
        ? err(missingColumn(expression.columnId))
        : ok({ sql: resolved.sql, parameters: [] });
    }

    case 'literal':
      return ok({ sql: '?', parameters: [expression.value] });

    case 'arithmetic': {
      const left = compileDerivedExpression(expression.left, context, depth + 1);

      if (!left.ok) return left;

      const right = compileDerivedExpression(expression.right, context, depth + 1);

      if (!right.ok) return right;

      const operator = ARITHMETIC_SQL[expression.op];

      if (operator === undefined) {
        return err(
          domainError('UNSUPPORTED_OPERATION', 'That arithmetic operator is not supported.', { op: expression.op }),
        );
      }

      // Return NULL for zero denominators so the query continues.
      const denominator = expression.op === 'div' ? `NULLIF(${right.value.sql}, 0)` : right.value.sql;

      return ok({
        sql: `(${left.value.sql} ${operator} ${denominator})`,
        parameters: [...left.value.parameters, ...right.value.parameters],
      });
    }

    case 'case': {
      const fragments: string[] = [];
      const parameters: unknown[] = [];

      for (const arm of expression.when) {
        const left = compileDerivedExpression(arm.left, context, depth + 1);

        if (!left.ok) return left;

        const right = compileDerivedExpression(arm.right, context, depth + 1);

        if (!right.ok) return right;

        const armResult = compileDerivedExpression(arm.result, context, depth + 1);

        if (!armResult.ok) return armResult;

        const operator = COMPARISON_SQL[arm.operator];

        if (operator === undefined) {
          return err(
            domainError('UNSUPPORTED_OPERATION', 'That comparison operator is not supported.', {
              operator: arm.operator,
            }),
          );
        }

        fragments.push(`WHEN ${left.value.sql} ${operator} ${right.value.sql} THEN ${armResult.value.sql}`);
        parameters.push(...left.value.parameters, ...right.value.parameters, ...armResult.value.parameters);
      }

      if (fragments.length === 0) {
        return err(domainError('UNSUPPORTED_OPERATION', 'A case expression needs at least one when arm.'));
      }

      const otherwise = compileDerivedExpression(expression.otherwise, context, depth + 1);

      if (!otherwise.ok) return otherwise;

      return ok({
        sql: `CASE ${fragments.join(' ')} ELSE ${otherwise.value.sql} END`,
        parameters: [...parameters, ...otherwise.value.parameters],
      });
    }

    case 'datePart': {
      const resolved = context.resolve(expression.columnId);

      if (resolved === undefined) return err(missingColumn(expression.columnId));

      const part = DATE_PART_SQL[expression.part];

      if (part === undefined) {
        return err(domainError('UNSUPPORTED_OPERATION', 'That date part is not supported.', { part: expression.part }));
      }

      return ok({ sql: `date_part('${part}', ${resolved.sql})`, parameters: [] });
    }

    case 'bin': {
      const resolved = context.resolve(expression.columnId);

      if (resolved === undefined) return err(missingColumn(expression.columnId));

      const bin = compileBinStrategy(expression.strategy, resolved.sql, context.rangeFor?.(expression.columnId));

      return bin.ok ? ok({ sql: bin.value.sql, parameters: bin.value.parameters }) : bin;
    }

    case 'cast': {
      const operand = compileDerivedExpression(expression.expr, context, depth + 1);

      if (!operand.ok) return operand;

      const target = CAST_SQL[expression.to];

      if (target === undefined) {
        return err(domainError('UNSUPPORTED_OPERATION', 'That cast target is not supported.', { to: expression.to }));
      }

      // Invalid casts become NULL so they do not abort the query.
      return ok({ sql: `TRY_CAST(${operand.value.sql} AS ${target})`, parameters: operand.value.parameters });
    }
  }
};
