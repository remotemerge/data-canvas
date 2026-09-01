import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { addAnnotationSchema } from './add-annotation.schema.ts';
import { analyzeDataSchema } from './analyze-data.schema.ts';
import { applyFilterSchema } from './apply-filter.schema.ts';
import { clearFiltersSchema } from './clear-filters.schema.ts';
import { clearSelectionSchema } from './clear-selection.schema.ts';
import { createDerivedColumnSchema } from './create-derived-column.schema.ts';
import { createMetricSchema } from './create-metric.schema.ts';
import { createRelationshipSchema } from './create-relationship.schema.ts';
import { createVisualizationSchema } from './create-visualization.schema.ts';
import { getColumnStatisticsSchema } from './get-column-statistics.schema.ts';
import { getDatasetSchemaSchema } from './get-dataset-schema.schema.ts';
import { getWorkspaceSchema } from './get-workspace.schema.ts';
import { highlightSelectionSchema } from './highlight-selection.schema.ts';
import { historySchema } from './history.schema.ts';
import { listRelationshipsSchema } from './list-relationships.schema.ts';
import { previewDataSchema } from './preview-data.schema.ts';
import { removeVisualizationSchema } from './remove-visualization.schema.ts';
import { updateVisualizationSchema } from './update-visualization.schema.ts';

export const toolSchemas = {
  get_workspace: getWorkspaceSchema,
  get_dataset_schema: getDatasetSchemaSchema,
  preview_data: previewDataSchema,
  analyze_data: analyzeDataSchema,
  get_column_statistics: getColumnStatisticsSchema,
  list_relationships: listRelationshipsSchema,
  create_relationship: createRelationshipSchema,
  create_visualization: createVisualizationSchema,
  update_visualization: updateVisualizationSchema,
  remove_visualization: removeVisualizationSchema,
  apply_filter: applyFilterSchema,
  clear_filters: clearFiltersSchema,
  clear_selection: clearSelectionSchema,
  highlight_selection: highlightSelectionSchema,
  undo: historySchema,
  redo: historySchema,
  create_metric: createMetricSchema,
  create_derived_column: createDerivedColumnSchema,
  add_annotation: addAnnotationSchema,
} as const;

export type ToolName = keyof typeof toolSchemas;

/*
 * Agent-facing argument contract version, reported by get_workspace. Descriptors are unreachable to
 * an agent whose browser lacks navigator.modelContext, so a returning agent with cached tool shapes
 * has no other way to notice that a property was renamed. Increment whenever a tool schema changes
 * in a way that invalidates arguments an agent may have cached.
 */
export const TOOL_CONTRACT_VERSION = 1;

const ajv = new Ajv({ strict: true, allErrors: true });

export const toolValidators: Record<ToolName, ValidateFunction> = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, schema]) => [name, ajv.compile(schema)]),
) as Record<ToolName, ValidateFunction>;
