import type { CreateRelationshipInput } from '@/application/actions/action-types.ts';
import type { JoinKind, RelationshipKeyPair, RelationshipKind } from '@/domain/relationship/relationship.ts';
import type { DataCanvasTool, ToolDependencies } from '@/webmcp/registry/tool-types.ts';
import { toolSchemas } from '@/webmcp/schemas/compile-schemas.ts';
import { asInput, failure, success } from '@/webmcp/tools/tool-helpers.ts';

// Normalizes the camelCase kind values that round-1 contracts accepted.
const KIND_ALIAS: Readonly<Record<string, RelationshipKind>> = {
  oneToOne: 'one_to_one',
  oneToMany: 'one_to_many',
  manyToOne: 'many_to_one',
};

// Creates a relationship from validated dataset and column IDs.
export const createCreateRelationshipTool = (deps: ToolDependencies): DataCanvasTool => ({
  name: 'create_relationship',
  title: 'Create dataset relationship',
  description:
    'Connect two datasets on key columns so analyze_data can use columns from both. Call list_relationships with includeSuggestions first to find likely key pairs and avoid duplicating a relationship. Adding the correct relationship can resolve a NO_JOIN_PATH error. Choose the cardinality carefully because the wrong kind can multiply rows and inflate totals. The returned summary reports detected fan-out. The application generates the join SQL; this tool accepts only dataset and column IDs.',
  schema: toolSchemas.create_relationship,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  needsDataset: true,
  // A relationship joins two datasets, so one import is not enough for this tool to succeed.
  minimumDatasets: 2,
  handler: async (raw) => {
    const input = asInput(raw);
    const kindRaw = input.kind as string;
    const kind: RelationshipKind = KIND_ALIAS[kindRaw] ?? (kindRaw as RelationshipKind);
    const payload: CreateRelationshipInput = {
      leftDatasetId: input.leftDatasetId as string,
      rightDatasetId: input.rightDatasetId as string,
      on: input.on as RelationshipKeyPair[],
      kind,
      join: input.join as JoinKind,
    };

    const result = await deps.dispatcher.execute(
      { type: 'relationship.create', payload },
      { actor: 'agent', expectedRevision: input.expectedRevision as number },
    );

    if (!result.ok) {
      return failure(result.error);
    }

    return success({
      revision: result.value.revision,
      // Return the fan-out warning from the action summary.
      summary: result.value.summary,
      relationshipId: result.value.changedEntityIds[0],
    });
  },
});
