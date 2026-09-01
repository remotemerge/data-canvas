import type { WebMcpToolAnnotations } from '@mcp-b/webmcp-types';
import type { Workspace } from '@/domain/workspace/workspace.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { AnalysisResult, TableWindow } from '@/application/ports/data-engine-port.ts';
import type { ColumnProfile } from '@/application/queries/column-statistics.ts';
import type { ApplicationActions } from '@/application/actions/action-types.ts';
import type { ActionResult } from '@/application/actions/action-types.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';
import type { ToolName } from '@/webmcp/schemas/compile-schemas.ts';

export interface DataCanvasTool {
  name: ToolName;
  description: string;
  schema: object;
  annotations: WebMcpToolAnnotations;
  needsDataset: boolean;
  handler(input: unknown): Promise<string>;
}

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
