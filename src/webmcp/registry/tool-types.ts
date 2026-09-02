import type { WebMcpToolAnnotations } from '@mcp-b/webmcp-types';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { AnalysisResult, TableWindow } from '@/application/ports/data-engine-port.ts';
import type { ColumnProfile } from '@/application/queries/column-statistics.ts';
import type { ActionResult, ApplicationActions } from '@/application/actions/action-types.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import type { ToolName } from '@/webmcp/schemas/compile-schemas.ts';

export interface DataCanvasTool {
  name: ToolName;
  description: string;
  schema: object;
  annotations: WebMcpToolAnnotations;
  needsDataset: boolean;
  /**
   * Ready datasets this tool needs before it can succeed, when one is not enough.
   *
   * Registering a tool that cannot yet succeed asks an agent to discover the precondition by failing
   * a call. Relationship tools need two datasets to join, so they stay unregistered until a second
   * import completes. Defaults to 1 for `needsDataset` tools.
   */
  minimumDatasets?: number;
  handler(input: unknown): Promise<string>;
}

// Ready datasets required before a tool is registered.
export const requiredDatasetCount = (tool: DataCanvasTool): number =>
  tool.needsDataset ? Math.max(tool.minimumDatasets ?? 1, 1) : 0;

export interface ToolDependencies {
  dispatcher: ApplicationActions;
  history?: {
    undo(expectedRevision?: number): Promise<Result<ActionResult, DomainError>>;
    redo(expectedRevision?: number): Promise<Result<ActionResult, DomainError>>;
  };
  getWorkspace(): Workspace;
  fetchTableWindow(request: {
    datasetId: string;
    offset: number;
    limit: number;
    filters: Workspace['filters'][string][];
  }): Promise<Result<TableWindow, DomainError>>;
  executeAnalysis(query: AnalysisQuery): Promise<Result<AnalysisResult, DomainError>>;
  fetchColumnStatistics(request: {
    datasetId: string;
    columnId: string;
    topValueLimit?: number;
  }): Promise<Result<ColumnProfile, DomainError>>;
}
