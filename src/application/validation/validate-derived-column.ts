import { createColumnTypeResolver, inferExpressionType } from '@/application/validation/infer-expression-type.ts';
import { validateBinStrategy } from '@/application/validation/validate-bin-strategy.ts';
import {
  ARITHMETIC_OPERATORS,
  CAST_TARGETS,
  COMPARISON_OPERATORS,
  DATE_PARTS,
  MAX_EXPRESSION_DEPTH,
  MAX_EXPRESSION_NODES,
  childExpressions,
  expressionColumnIds,
  expressionDepth,
  expressionNodeCount,
} from '@/domain/analysis/derived-expression.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import { MAX_DERIVED_COLUMN_NAME_LENGTH } from '@/domain/dataset/derived-column.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Dataset } from '@/domain/dataset/dataset.ts';
import type { LogicalType } from '@/domain/logical-type.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * Checks the parts of the tree Ajv cannot express.
 *
 * JSON Schema can describe the node shapes through a `$ref`, but it has no way to bound recursion
 * depth or total node count. Those limits live here, which is why the domain validator runs on
 * every tree even after Ajv has accepted it.
 */
const validateStructure = (expression: DerivedExpression): Result<void, DomainError> => {
  const depth = expressionDepth(expression);

  if (depth > MAX_EXPRESSION_DEPTH) {
    return err(
      domainError(
        'RESULT_LIMIT_EXCEEDED',
        `Expression nesting is ${depth} levels deep; the limit is ${MAX_EXPRESSION_DEPTH}.`,
        { depth, maxDepth: MAX_EXPRESSION_DEPTH },
      ),
    );
  }

  const nodes = expressionNodeCount(expression);

  if (nodes > MAX_EXPRESSION_NODES) {
    return err(
      domainError('RESULT_LIMIT_EXCEEDED', `Expression has ${nodes} nodes; the limit is ${MAX_EXPRESSION_NODES}.`, {
        nodes,
        maxNodes: MAX_EXPRESSION_NODES,
      }),
    );
  }

  return ok(undefined);
};

/**
 * Rejects enum values outside the closed sets the compiler can emit.
 *
 * The type system already forbids these, but a tree arriving from a WebMCP call is `unknown` cast
 * into shape, so the guarantee has to be re-established at runtime before the compiler trusts it.
 */
const validateNodes = (expression: DerivedExpression): Result<void, DomainError> => {
  switch (expression.kind) {
    case 'arithmetic':
      if (!ARITHMETIC_OPERATORS.includes(expression.op)) {
        return err(
          domainError('UNSUPPORTED_OPERATION', `Unknown arithmetic operator '${expression.op as string}'.`, {
            operator: expression.op,
          }),
        );
      }
      break;

    case 'datePart':
      if (!DATE_PARTS.includes(expression.part)) {
        return err(
          domainError('UNSUPPORTED_OPERATION', `Unknown date part '${expression.part as string}'.`, {
            part: expression.part,
          }),
        );
      }
      break;

    case 'cast':
      if (!CAST_TARGETS.includes(expression.to)) {
        return err(
          domainError('UNSUPPORTED_OPERATION', `Unknown cast target '${expression.to as string}'.`, {
            to: expression.to,
          }),
        );
      }
      break;

    case 'case':
      for (const arm of expression.when) {
        if (!COMPARISON_OPERATORS.includes(arm.operator)) {
          return err(
            domainError('UNSUPPORTED_OPERATION', `Unknown comparison operator '${arm.operator as string}'.`, {
              operator: arm.operator,
            }),
          );
        }
      }
      break;

    case 'bin': {
      const strategy = validateBinStrategy(expression.strategy);

      if (!strategy.ok) return strategy;
      break;
    }

    case 'column':
    case 'literal':
      break;
  }

  for (const child of childExpressions(expression)) {
    const result = validateNodes(child);

    if (!result.ok) return result;
  }

  return ok(undefined);
};

/**
 * Walks the derived-column reference graph looking for a cycle.
 *
 * A derived column may build on another, so the references form a graph rather than a tree. Left
 * unchecked, a mutual reference would make the compiler recurse until the stack gave out. The rule
 * and the reasoning are the same as for relationship cycles.
 *
 * `candidateId` is the column being created or replaced, and `expression` its proposed definition,
 * so the check runs against the graph as it would be rather than as it is.
 */
const findsCycle = (
  candidateId: EntityId,
  expression: DerivedExpression,
  existing: Record<EntityId, DerivedColumn>,
): boolean => {
  const visiting = new Set<EntityId>();

  const visit = (columnId: EntityId, definition: DerivedExpression | undefined): boolean => {
    if (visiting.has(columnId)) return true;
    if (definition === undefined) return false;

    visiting.add(columnId);

    for (const referenced of expressionColumnIds(definition)) {
      const next = referenced === candidateId ? expression : existing[referenced]?.expression;

      if (next !== undefined && visit(referenced, next)) return true;
    }

    visiting.delete(columnId);

    return false;
  };

  return visit(candidateId, expression);
};

export interface DerivedColumnCandidate {
  /** Present when replacing an existing definition, absent when creating one. */
  id?: EntityId;
  name: string;
  expression: DerivedExpression;
}

export interface ValidatedDerivedColumn {
  name: string;
  logicalType: LogicalType;
}

/**
 * Validates a derived column against the dataset and the existing derived columns.
 *
 * Runs the checks in the order that produces the most useful message: structure first, because a
 * pathological tree should be rejected before anything walks it repeatedly; then node vocabulary;
 * then references and types; then cycles, which need a resolvable graph to be meaningful.
 */
export const validateDerivedColumn = (
  dataset: Dataset,
  candidate: DerivedColumnCandidate,
  derivedColumns: Record<EntityId, DerivedColumn>,
): Result<ValidatedDerivedColumn, DomainError> => {
  const name = candidate.name.trim();

  if (name.length === 0 || name.length > MAX_DERIVED_COLUMN_NAME_LENGTH) {
    return err(
      domainError(
        'UNSUPPORTED_OPERATION',
        `Derived column name must be between 1 and ${MAX_DERIVED_COLUMN_NAME_LENGTH} characters.`,
        { maxLength: MAX_DERIVED_COLUMN_NAME_LENGTH },
      ),
    );
  }

  const structure = validateStructure(candidate.expression);

  if (!structure.ok) return structure;

  const nodes = validateNodes(candidate.expression);

  if (!nodes.ok) return nodes;

  const candidateId = candidate.id ?? '';

  // Cycles are checked before types. Inference resolves against the graph *without* the column
  // being replaced, so a self-reference would otherwise be reported as a missing column and hide
  // the real problem.
  if (candidateId !== '' && findsCycle(candidateId, candidate.expression, derivedColumns)) {
    return err(
      domainError('UNSUPPORTED_OPERATION', 'This definition would make the derived column reference itself.', {
        columnId: candidateId,
      }),
    );
  }

  // A new column has no ID yet, so it cannot close a loop through its own name. What it can do is
  // reference one that is already cyclic, which this covers.
  for (const referenced of expressionColumnIds(candidate.expression)) {
    const definition = derivedColumns[referenced];

    if (definition !== undefined && findsCycle(referenced, definition.expression, derivedColumns)) {
      return err(
        domainError('UNSUPPORTED_OPERATION', 'This definition references a derived column that is already cyclic.', {
          columnId: referenced,
        }),
      );
    }
  }

  // Only derived columns on the same dataset are in scope. A derived column referencing another
  // dataset's column would need a join path the expression has no way to name.
  const sameDataset = Object.values(derivedColumns).filter(
    (column) => column.datasetId === dataset.id && column.id !== candidate.id,
  );

  const resolve = createColumnTypeResolver(dataset.columns, sameDataset);
  const inferred = inferExpressionType(candidate.expression, resolve);

  if (!inferred.ok) return inferred;

  return ok({ name, logicalType: inferred.value });
};
