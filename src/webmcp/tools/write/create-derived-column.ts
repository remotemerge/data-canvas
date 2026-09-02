import type { CreateDerivedColumnInput } from '@/application/actions/action-types.ts';
import type { DerivedExpression } from '@/domain/analysis/derived-expression.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

// Adds a derived column from a validated expression tree.
export const createCreateDerivedColumnTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'create_derived_column',
  title: 'Create derived column',
  description:
    'Add a permanent computed column from a structured expression tree of column references, literals, arithmetic, conditionals, date parts, bins, and casts. Use it when later filters, charts, or analyses need a value the dataset lacks, such as a margin ratio or category band. Prefer analyze_data or a chart aggregate for a one-off figure. Formula strings and SQL are not accepted.',
  schema: toolSchemas.create_derived_column,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
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

    if (!result.ok) {
      return failure(result.error);
    }

    return success({
      revision: result.value.revision,
      summary: result.value.summary,
      derivedColumnId: result.value.changedEntityIds[0],
    });
  },
});
