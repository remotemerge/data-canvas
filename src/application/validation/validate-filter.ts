import type { Column } from '@/domain/dataset/dataset.ts';
import { FILTER_OPERATORS, NULLARY_FILTER_OPERATORS } from '@/domain/filter/filter.ts';
import type { FilterOperator } from '@/domain/filter/filter.ts';
import { isNumericType, isTemporalType, isTextType } from '@/domain/logical-type.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

// Maximum number of values in an `in` or `not_in` filter.
export const MAX_FILTER_VALUE_LIST_LENGTH = 500;

/* Schema validates filter shape. These checks validate operator compatibility against the column and
 * keep rejected values out of errors that cross the agent boundary. */

// Checks whether a value matches a column's logical type.
const matchesLogicalType = (value: unknown, logicalType: LogicalType): boolean => {
  switch (logicalType) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
    case 'category':
      return typeof value === 'string';
    case 'date':
    case 'timestamp':
      // The compiler normalizes ISO strings and epoch milliseconds to the engine's temporal type.
      return (typeof value === 'string' && !Number.isNaN(Date.parse(value))) || typeof value === 'number';
    case 'unknown':
      // Unknown columns accept non-null values; the engine decides their physical type.
      return value !== null && value !== undefined;
  }
};

const typeMismatch = (column: Column, operator: FilterOperator): DomainError =>
  domainError(
    'INCOMPATIBLE_COLUMN',
    `Operator '${operator}' requires a ${column.logicalType} value for column '${column.name}'.`,
    { columnId: column.id, operator, logicalType: column.logicalType },
  );

const incompatible = (column: Column, operator: FilterOperator, requirement: string): DomainError =>
  domainError(
    'INCOMPATIBLE_COLUMN',
    `Operator '${operator}' requires ${requirement}; column '${column.name}' is ${column.logicalType}.`,
    { columnId: column.id, operator, logicalType: column.logicalType },
  );

const validateOrdered = (column: Column, operator: FilterOperator, value: unknown): Result<void, DomainError> => {
  if (!isNumericType(column.logicalType) && !isTemporalType(column.logicalType)) {
    return err(incompatible(column, operator, 'a numeric or temporal column'));
  }

  if (value === undefined) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `Operator '${operator}' requires a value for column '${column.name}'.`, {
        columnId: column.id,
        operator,
      }),
    );
  }

  return matchesLogicalType(value, column.logicalType) ? ok(undefined) : err(typeMismatch(column, operator));
};

// Converts a filter value to the numeric scale used for comparison.
const toComparable = (bound: unknown): number => (typeof bound === 'number' ? bound : Date.parse(bound as string));

const validateBetween = (column: Column, value: unknown): Result<void, DomainError> => {
  if (!isNumericType(column.logicalType) && !isTemporalType(column.logicalType)) {
    return err(incompatible(column, 'between', 'a numeric or temporal column'));
  }

  if (!Array.isArray(value) || value.length !== 2) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `Operator 'between' requires a [lower, upper] pair for '${column.name}'.`, {
        columnId: column.id,
        operator: 'between',
      }),
    );
  }

  const [lower, upper] = value as [unknown, unknown];

  if (!matchesLogicalType(lower, column.logicalType) || !matchesLogicalType(upper, column.logicalType)) {
    return err(typeMismatch(column, 'between'));
  }

  return toComparable(lower) <= toComparable(upper)
    ? ok(undefined)
    : err(
        domainError(
          'INCOMPATIBLE_COLUMN',
          `Operator 'between' requires the lower bound to not exceed the upper bound for '${column.name}'.`,
          { columnId: column.id, operator: 'between' },
        ),
      );
};

const validateMembership = (column: Column, operator: FilterOperator, value: unknown): Result<void, DomainError> => {
  if (!Array.isArray(value) || value.length === 0) {
    return err(
      domainError('INCOMPATIBLE_COLUMN', `Operator '${operator}' requires a non-empty list for '${column.name}'.`, {
        columnId: column.id,
        operator,
      }),
    );
  }

  if (value.length > MAX_FILTER_VALUE_LIST_LENGTH) {
    return err(
      domainError(
        'RESULT_LIMIT_EXCEEDED',
        `Operator '${operator}' accepts at most ${MAX_FILTER_VALUE_LIST_LENGTH} values for '${column.name}'.`,
        { columnId: column.id, operator, maxLength: MAX_FILTER_VALUE_LIST_LENGTH },
      ),
    );
  }

  return value.every((entry) => matchesLogicalType(entry, column.logicalType))
    ? ok(undefined)
    : err(typeMismatch(column, operator));
};

const validateNullary = (column: Column, operator: FilterOperator, value: unknown): Result<void, DomainError> =>
  value === undefined
    ? ok(undefined)
    : err(
        domainError('INCOMPATIBLE_COLUMN', `Operator '${operator}' takes no value; remove it for '${column.name}'.`, {
          columnId: column.id,
          operator,
        }),
      );

const validateContains = (column: Column, value: unknown): Result<void, DomainError> => {
  if (!isTextType(column.logicalType)) {
    return err(incompatible(column, 'contains', 'a string or category column'));
  }

  return typeof value === 'string' && value.length > 0
    ? ok(undefined)
    : err(
        domainError('INCOMPATIBLE_COLUMN', `Operator 'contains' requires non-empty text for '${column.name}'.`, {
          columnId: column.id,
          operator: 'contains',
        }),
      );
};

const validateEquality = (column: Column, operator: FilterOperator, value: unknown): Result<void, DomainError> => {
  if (value === undefined) {
    return err(
      domainError(
        'INCOMPATIBLE_COLUMN',
        `Operator '${operator}' requires a value for '${column.name}'; use 'is_null' to match missing values.`,
        { columnId: column.id, operator },
      ),
    );
  }

  return matchesLogicalType(value, column.logicalType) ? ok(undefined) : err(typeMismatch(column, operator));
};

// Validates a filter against its resolved column.
export const validateFilter = (column: Column, operator: FilterOperator, value: unknown): Result<void, DomainError> => {
  if (NULLARY_FILTER_OPERATORS.includes(operator)) {
    return validateNullary(column, operator, value);
  }

  switch (operator) {
    case 'between':
      return validateBetween(column, value);
    case 'in':
    case 'not_in':
      return validateMembership(column, operator, value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return validateOrdered(column, operator, value);
    case 'contains':
      return validateContains(column, value);
    case 'eq':
    case 'neq':
      return validateEquality(column, operator, value);
    default:
      return err(
        domainError('UNSUPPORTED_OPERATION', `Filter operator '${operator as string}' is not supported.`, { operator }),
      );
  }
};

export const getCompatibleFilterOperators = (column: Column): FilterOperator[] =>
  FILTER_OPERATORS.filter((operator) => {
    if (operator === 'contains') {
      return isTextType(column.logicalType);
    }
    if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte' || operator === 'between') {
      return isNumericType(column.logicalType) || isTemporalType(column.logicalType);
    }
    return true;
  });
