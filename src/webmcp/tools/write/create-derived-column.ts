import type { CreateDerivedColumnInput } from '@/application/actions/action-types.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

/**
 * Adds a derived column from a validated expression tree.
 *
 * The tree is the reason this tool can exist at all. A formula string would be arbitrary SQL behind
 * a friendlier name; a closed node vocabulary is something the compiler can emit safely.
 *
 * Ajv checks the tree's shape through a recursive `$ref`, which cannot express a depth limit. The
 * dispatcher's validator enforces depth, node count, type compatibility, and acyclicity, so both
 * layers run before anything compiles.
 */
export const createCreateDerivedColumnTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'create_derived_column',
  description:
    'Add a computed column from a structured expression tree of columns, literals, arithmetic, conditionals, date parts, bins, and casts. Formula strings and SQL are not accepted.',
  schema: toolSchemas.create_derived_column,
  annotations: { readOnlyHint: false },
  needsDataset: true,
  handler: async (raw) => {
    const input = asInput(raw);
    const payload: CreateDerivedColumnInput = {
      datasetId: input.datasetId as string,
      name: input.name as string,
      expression: input.expression as DerivedExpression,
    };

    const result = await deps.dispatcher.execute(
      { type: 'derivedColumn.create', payload },
      { actor: 'agent', expectedRevision: input.expectedRevision as number | undefined },
    );

    if (!result.ok) return failure(result.error);

    return success({
      revision: result.value.revision,
      summary: result.value.summary,
      derivedColumnId: result.value.changedEntityIds[0],
    });
  },
});
