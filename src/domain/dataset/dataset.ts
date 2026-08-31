import type { LogicalType } from '@/domain/logical-type.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';

export type DatasetSourceKind = 'csv' | 'json';

export interface DatasetSource {
  kind: DatasetSourceKind;
  // Display-only filename; never used as a SQL identifier.
  fileName: string;
  byteSize: number;
  importedAt: string;
}

export interface Column {
  id: EntityId;
  // Human-facing dataset label.
  name: string;
  // Physical column identifier used by the query compiler.
  physicalName: string;
  databaseType: string;
  logicalType: LogicalType;
  nullable: boolean;
}

export type DatasetImportStatus = 'loading' | 'ready' | 'error';

export interface Dataset {
  id: EntityId;
  name: string;
  // Generated DuckDB relation name; never derived from user input.
  relationId: string;
  source: DatasetSource;
  rowCount: number | null;
  columns: Column[];
  revision: number;
  importStatus: DatasetImportStatus;
}
