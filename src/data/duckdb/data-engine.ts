import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type {
  AnalysisExecutionOptions,
  AnalysisResult,
  ColumnRangeRequest,
  ColumnStatistics,
  ColumnStatisticsRequest,
  DataEnginePort,
  DistinctValuesRequest,
  DistinctValuesResult,
  ImportedRelation,
  ImportProgress,
  KeyQualityRequest,
  KeyQualityResult,
  TableWindow,
  TableWindowRequest,
} from '@/application/ports/data-engine-port.ts';
import { createQueryCache } from '@/application/queries/query-cache.ts';
import { compileAnalysisQuery } from '@/data/compiler/compile-analysis-query.ts';
import type { CompiledQuery, QueryDataset } from '@/data/compiler/compile-analysis-query.ts';
import { readArrowRows, readScalarCount } from '@/data/duckdb/arrow-conversion.ts';
import type { ArrowRowSource } from '@/data/duckdb/arrow-conversion.ts';
import { closeDuckDB, openDuckDB } from '@/data/duckdb/duckdb-bootstrap.ts';
import type { DuckDBHandle } from '@/data/duckdb/duckdb-bootstrap.ts';
import {
  createColumnName,
  createRelationName,
  quoteIdentifier,
  stagingRelationName,
  virtualImportPath,
} from '@/data/duckdb/identifier-safety.ts';
import { CATEGORY_DISTINCT_THRESHOLD, normalizeLogicalType, refineTextType } from '@/data/duckdb/type-normalization.ts';
import { createQueryScheduler, QueryAbortedError } from '@/data/duckdb/query-scheduler.ts';
import type { QueryScheduler } from '@/data/duckdb/query-scheduler.ts';
import { planQuery } from '@/data/compiler/query-planner.ts';
import { createStatisticsCache } from '@/application/queries/statistics-cache.ts';
import type { DatasetCardinality } from '@/data/compiler/join-ordering.ts';
import { ingestionFailure, validateColumnCount, validateImportFile } from '@/data/import/import-dataset.ts';
import type { ValidatedFile } from '@/data/import/import-dataset.ts';
import { jsonToCsvBytes } from '@/data/import/json-to-csv.ts';
import { MAX_TABLE_WINDOW_ROWS } from '@/data/import/import-limits.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { ColumnRange } from '@/domain/analysis/bin-strategy.ts';
import type { DerivedColumn } from '@/domain/dataset/derived-column.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import type { Relationship } from '@/domain/relationship/relationship.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * DuckDB-Wasm implementation of `DataEnginePort`.
 *
 * The connection stays in this module. Callers receive domain types, and one scheduled connection
 * handles engine work.
 */

// Metadata tracked for an imported dataset. Raw rows remain in DuckDB.
interface RelationEntry {
  relationName: string;
  columns: Column[];
  revision: number;
  // Row count recorded during import. Missing means unknown, not zero.
  rowCount?: number;
}

// One row of DuckDB's `DESCRIBE` output. Only the two fields the engine uses are declared.
interface DescribedColumn {
  column_name: unknown;
  column_type: unknown;
  null: unknown;
}

export interface DataEngine extends DataEnginePort {
  initialize(): Promise<Result<void, DomainError>>;
  dispose(): Promise<void>;
  // Publishes relationship definitions used by the query compiler.
  setRelationships(relationships: Record<EntityId, Relationship>): void;
  // Publishes derived-column definitions used by the query compiler.
  setDerivedColumns(derivedColumns: Record<EntityId, DerivedColumn>): void;
}

// Runs engine work and maps DuckDB exceptions to a value-free typed error.
const engineFailure = (code: 'QUERY_FAILED' | 'IMPORT_FAILED'): DomainError =>
  code === 'IMPORT_FAILED'
    ? ingestionFailure()
    : domainError('QUERY_FAILED', 'The query could not be completed against the imported data.');

// Reads a relation schema in physical column order.
const describeRelation = async (
  connection: AsyncDuckDBConnection,
  relationName: string,
): Promise<DescribedColumn[]> => {
  const described = await connection.query(`DESCRIBE ${quoteIdentifier(relationName)}`);

  return described.toArray() as unknown as DescribedColumn[];
};

// Counts distinct text values, capped at the category threshold plus one.
const countDistinctBounded = async (
  connection: AsyncDuckDBConnection,
  relationName: string,
  physicalName: string,
): Promise<number> => {
  const counted = await connection.query(
    `SELECT count(*) FROM (SELECT DISTINCT ${quoteIdentifier(physicalName)} FROM ${quoteIdentifier(relationName)} LIMIT ${CATEGORY_DISTINCT_THRESHOLD + 1})`,
  );

  return readScalarCount(counted as unknown as ArrowRowSource);
};

/**
 * Rewrites the staging relation with generated physical column names.
 *
 * Headers remain display text and never become SQL identifiers.
 */
const materializeRelation = async (
  connection: AsyncDuckDBConnection,
  stagingName: string,
  relationName: string,
  columnCount: number,
): Promise<void> => {
  const aliases = Array.from({ length: columnCount }, (_unused, ordinal) =>
    quoteIdentifier(createColumnName(ordinal)),
  ).join(', ');

  await connection.query(
    `CREATE OR REPLACE TABLE ${quoteIdentifier(relationName)} (${aliases}) AS SELECT * FROM ${quoteIdentifier(stagingName)}`,
  );
};

const dropRelation = async (connection: AsyncDuckDBConnection, relationName: string): Promise<void> => {
  await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(relationName)}`).catch(() => undefined);
};

// Builds domain columns, keeping display headers separate from generated physical names.
const buildColumns = async (
  connection: AsyncDuckDBConnection,
  relationName: string,
  described: readonly DescribedColumn[],
  displayNames: readonly string[],
): Promise<Column[]> => {
  const columns: Column[] = [];

  for (const [ordinal, entry] of described.entries()) {
    const databaseType = String(entry.column_type ?? 'UNKNOWN');
    const physicalName = createColumnName(ordinal);
    const baseType = normalizeLogicalType(databaseType);

    // Profile text columns sequentially because this connection executes one query at a time.
    const logicalType =
      baseType === 'string'
        ? // eslint-disable-next-line no-await-in-loop -- see above
          refineTextType(baseType, await countDistinctBounded(connection, relationName, physicalName))
        : baseType;

    columns.push({
      id: createEntityId(ID_PREFIX.column),
      name: displayNames[ordinal] ?? physicalName,
      physicalName,
      databaseType,
      logicalType,
      // Treat unexpected nullability metadata as nullable, the safe direction.
      nullable: String(entry.null ?? 'YES').toUpperCase() !== 'NO',
    });
  }

  return columns;
};

const queryDataset = (datasetId: EntityId, relation: RelationEntry): QueryDataset => ({
  id: datasetId,
  relationId: relation.relationName,
  columns: relation.columns,
});

// Ratio above which joined rows are reported as fan-out.
const FAN_OUT_QUERY_TOLERANCE = 1.05;

// Bounds for column profiling and value disclosure.
const DISTINCT_COUNT_CAP = 10_000;
const MAX_TOP_VALUES = 20;
const MAX_STATISTIC_STRING_LENGTH = 200;

export const describeQueryFanOut = (anchorRows: number, joinedRows: number): string | undefined => {
  if (anchorRows <= 0 || joinedRows <= anchorRows * FAN_OUT_QUERY_TOLERANCE) {
    return undefined;
  }

  return `This join produced about ${(joinedRows / anchorRows).toFixed(2)} rows per source row, so aggregate totals may be inflated by duplicate key matches.`;
};

/**
 * Prepares and executes a compiled statement.
 *
 * Check cancellation around each await because DuckDB-Wasm has no `AbortSignal` support. Always
 * close the prepared statement.
 */
const executeCompiled = async (
  connection: AsyncDuckDBConnection,
  compiled: CompiledQuery,
  signal?: AbortSignal,
): Promise<ArrowRowSource> => {
  if (signal?.aborted) {
    throw new QueryAbortedError();
  }

  const statement = await connection.prepare(compiled.sql);
  try {
    if (signal?.aborted) {
      throw new QueryAbortedError();
    }

    return (await statement.query(...compiled.parameters)) as unknown as ArrowRowSource;
  } finally {
    await statement.close();
  }
};

/**
 * Reads a file into a contiguous buffer and reports byte progress.
 *
 * Streaming provides progress; the fallback supports environments without `stream()`.
 */
const readFileBytes = async (file: File, onProgress?: (progress: ImportProgress) => void): Promise<Uint8Array> => {
  const totalBytes = file.size;

  if (typeof file.stream !== 'function') {
    onProgress?.({ phase: 'reading', bytesRead: 0, totalBytes });

    const buffer = new Uint8Array(await file.arrayBuffer());

    onProgress?.({ phase: 'reading', bytesRead: totalBytes, totalBytes });

    return buffer;
  }

  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  onProgress?.({ phase: 'reading', bytesRead, totalBytes });

  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- stream reads are sequential.
    const { done, value } = await reader.read();

    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }

    chunks.push(value);
    bytesRead += value.byteLength;
    onProgress?.({ phase: 'reading', bytesRead, totalBytes });
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

const enabledExpressions = (filters: readonly Filter[]) =>
  filters
    .filter((filter) => filter.enabled)
    .map((filter) => ({
      kind: 'comparison' as const,
      columnId: filter.columnId,
      operator: filter.operator,
      ...(filter.value === undefined ? {} : { value: filter.value }),
    }));

export const createDataEngine = (): DataEngine => {
  let handle: DuckDBHandle | null = null;
  let initializing: Promise<Result<void, DomainError>> | null = null;

  const scheduler: QueryScheduler = createQueryScheduler();

  // Session relation metadata by dataset ID. Raw rows remain in DuckDB.
  const relations = new Map<EntityId, RelationEntry>();

  // Relationship definitions supplied by the application.
  const relationshipGraph = new Map<EntityId, Relationship>();

  // Derived-column definitions supplied by the application.
  let derivedColumnDefinitions: Record<EntityId, DerivedColumn> = {};
  const countCache = createQueryCache<number>();

  // Cached row counts and column extents keyed by dataset revision.
  const statisticsCache = createStatisticsCache();

  // Row-count estimates used by join ordering.
  const datasetCardinalities = (): DatasetCardinality[] =>
    [...relations.entries()].map(([datasetId, relation]) => ({
      datasetId,
      ...(relation.rowCount === undefined ? {} : { rowCount: relation.rowCount }),
    }));

  const requireConnection = (): Result<AsyncDuckDBConnection, DomainError> =>
    handle === null
      ? err(domainError('ENGINE_UNAVAILABLE', 'The analytical engine is not available yet.'))
      : ok(handle.connection);

  /**
   * Ingests a validated file into a staging relation.
   *
   * JSON is converted to CSV so import uses DuckDB's built-in reader. The virtual path derives from
   * the generated relation ID, not the filename.
   */
  const ingestStaging = async (
    connection: AsyncDuckDBConnection,
    validated: ValidatedFile,
    stagingName: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<readonly string[]> => {
    const raw = await readFileBytes(validated.file, onProgress);
    const isJson = validated.sourceKind === 'json';

    onProgress?.({ phase: 'ingesting' });
    const buffer = isJson ? jsonToCsvBytes(new TextDecoder().decode(raw)) : raw;
    const virtualPath = virtualImportPath(stagingName);

    await handle?.database.registerFileBuffer(virtualPath, buffer);

    try {
      await connection.insertCSVFromPath(virtualPath, {
        name: stagingName,
        schema: 'main',
        create: true,
        header: true,
        detect: true,
        // Converted JSON is comma-delimited; source delimiters apply only to verbatim files.
        ...(isJson || validated.delimiter === undefined ? {} : { delimiter: validated.delimiter }),
      });

      const staged = await describeRelation(connection, stagingName);

      return staged.map((entry) => String(entry.column_name ?? ''));
    } finally {
      // Release the registered buffer so worker memory does not retain a second file copy.
      await handle?.database.dropFile(virtualPath).catch(() => undefined);
    }
  };

  const importFile = async (
    file: unknown,
    datasetId: EntityId,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<Result<ImportedRelation, DomainError>> => {
    const connectionResult = requireConnection();

    if (!connectionResult.ok) {
      return connectionResult;
    }

    const validated = validateImportFile(file);

    if (!validated.ok) {
      return validated;
    }

    const connection = connectionResult.value;
    const relationName = createRelationName(datasetId);
    const stagingName = stagingRelationName(relationName);

    try {
      const displayNames = await ingestStaging(connection, validated.value, stagingName, onProgress);

      const columnCount = validateColumnCount(displayNames.length);

      if (!columnCount.ok) {
        await dropRelation(connection, stagingName);

        return columnCount;
      }

      await materializeRelation(connection, stagingName, relationName, displayNames.length);
      await dropRelation(connection, stagingName);

      // Profile text columns after ingestion; this is the longest phase for wide files.
      onProgress?.({ phase: 'profiling' });

      const described = await describeRelation(connection, relationName);
      const columns = await buildColumns(connection, relationName, described, displayNames);

      const counted = await connection.query(`SELECT count(*) FROM ${quoteIdentifier(relationName)}`);
      const rowCount = readScalarCount(counted as unknown as ArrowRowSource);

      const revision = (relations.get(datasetId)?.revision ?? 0) + 1;
      relations.set(datasetId, { relationName, columns, revision, rowCount });
      countCache.clear();
      statisticsCache.setDatasetStatistics(datasetId, revision, { rowCount });

      return ok({ relationId: relationName, rowCount, columns });
    } catch {
      // Leave no staging or canonical relation after a failed import.
      await dropRelation(connection, stagingName);
      await dropRelation(connection, relationName);

      return err(engineFailure('IMPORT_FAILED'));
    }
  };

  // Supplies the SQL compiler with session relations, relationships, and derived columns.
  const queryContext = (): {
    datasets: QueryDataset[];
    relationships: Relationship[];
    derivedColumns: Record<EntityId, DerivedColumn>;
  } => ({
    datasets: [...relations.entries()].map(([datasetId, relation]) => queryDataset(datasetId, relation)),
    relationships: [...relationshipGraph.values()],
    derivedColumns: derivedColumnDefinitions,
  });

  // Measures joined row count for aggregate queries that cross a join.
  const measureJoinFanOut = async (
    connection: AsyncDuckDBConnection,
    query: AnalysisQuery,
  ): Promise<string | undefined> => {
    const context = queryContext();
    const joined = compileAnalysisQuery(
      { ...query, dimensions: [], measures: [{ aggregate: 'count' }], orderBy: [], limit: 1 },
      context,
    );
    const anchor = compileAnalysisQuery(
      { datasetId: query.datasetId, dimensions: [], measures: [{ aggregate: 'count' }], filters: [], limit: 1 },
      context,
    );

    if (!joined.ok || !anchor.ok) {
      return undefined;
    }

    try {
      const joinedRows = readScalarCount(await executeCompiled(connection, joined.value));
      const anchorRows = readScalarCount(await executeCompiled(connection, anchor.value));

      return describeQueryFanOut(anchorRows, joinedRows);
    } catch {
      // Fan-out measurement is advisory; its failure must not fail the query.
      return undefined;
    }
  };

  /**
   * Runs an analysis query, optionally with keyed supersession.
   *
   * Internal reads stay unkeyed because they can run inside a scheduled query.
   */
  const executeAnalysis = async (
    query: AnalysisQuery,
    options?: AnalysisExecutionOptions,
  ): Promise<Result<AnalysisResult, DomainError>> => {
    const connectionResult = requireConnection();
    if (!connectionResult.ok) {
      return connectionResult;
    }
    const relation = relations.get(query.datasetId);
    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }
    const planned = planQuery(query, { ...queryContext(), cardinalities: datasetCardinalities() });
    const compiled = compileAnalysisQuery(planned.query, {
      ...queryContext(),
      ...(planned.joinOrder === undefined ? {} : { joinOrder: planned.joinOrder }),
    });
    if (!compiled.ok) {
      return compiled;
    }

    const run = async (signal?: AbortSignal): Promise<AnalysisResult> => {
      const table = await executeCompiled(connectionResult.value, compiled.value, signal);
      const fanOut =
        compiled.value.joined && query.measures.length > 0
          ? await measureJoinFanOut(connectionResult.value, planned.query)
          : undefined;
      return {
        rows: readArrowRows(
          table,
          compiled.value.resultColumns.map((column) => column.logicalType),
        ).rows,
        columns: compiled.value.resultColumns,
        ...(fanOut === undefined ? {} : { warning: fanOut }),
      };
    };

    if (options?.key === undefined) {
      try {
        return ok(await run(options?.signal));
      } catch {
        return err(engineFailure('QUERY_FAILED'));
      }
    }

    const scheduled = await scheduler
      .schedule((signal) => run(signal), {
        key: options.key,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      .catch(() => null);

    if (scheduled === null) {
      return err(engineFailure('QUERY_FAILED'));
    }

    // Superseded analysis is normal interaction; callers keep the previous result.
    if (scheduled.stale) {
      return ok({ rows: [], columns: compiled.value.resultColumns, stale: true });
    }

    return ok(scheduled.value);
  };

  // Measures duplicate join keys in a bounded sample.
  const measureKeyQuality = async (request: KeyQualityRequest): Promise<Result<KeyQualityResult, DomainError>> => {
    const connectionResult = requireConnection();
    if (!connectionResult.ok) {
      return connectionResult;
    }

    const relation = relations.get(request.datasetId);
    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }

    const identifiers: string[] = [];
    for (const columnId of request.columnIds) {
      const column = relation.columns.find((candidate) => candidate.id === columnId);
      if (column === undefined) {
        return err(domainError('COLUMN_NOT_FOUND', 'The key-quality check references a column that does not exist.'));
      }
      identifiers.push(quoteIdentifier(column.physicalName));
    }

    if (identifiers.length === 0) {
      return err(domainError('INVALID_TOOL_ARGUMENTS', 'A key-quality check needs at least one column.'));
    }

    const sampleRows = Math.min(Math.max(Math.trunc(request.sampleRows) || 0, 1), 100_000);

    try {
      const sample = `(SELECT ${identifiers.join(', ')} FROM ${quoteIdentifier(relation.relationName)} WHERE ${identifiers.map((identifier) => `${identifier} IS NOT NULL`).join(' AND ')} LIMIT ${sampleRows})`;
      const counted = await connectionResult.value.query(
        `SELECT count(*) AS ${quoteIdentifier('sampled')}, count(DISTINCT (${identifiers.join(', ')})) AS ${quoteIdentifier('distinct_keys')} FROM ${sample}`,
      );
      const [row] = readArrowRows(counted as unknown as ArrowRowSource, ['number', 'number']).rows;

      return ok({ sampledRows: Number(row?.[0] ?? 0), distinctKeys: Number(row?.[1] ?? 0) });
    } catch {
      return err(engineFailure('QUERY_FAILED'));
    }
  };

  const dropDataset = async (datasetId: EntityId): Promise<Result<void, DomainError>> => {
    const relation = relations.get(datasetId);

    // Removing a dataset without a relation is still successful.
    if (relation === undefined) {
      countCache.clear();

      return ok(undefined);
    }

    const connectionResult = requireConnection();
    if (!connectionResult.ok) {
      return connectionResult;
    }

    await dropRelation(connectionResult.value, relation.relationName);
    statisticsCache.invalidateDataset(
      datasetId,
      relation.columns.map((column) => column.id),
    );
    relations.delete(datasetId);
    countCache.clear();

    return ok(undefined);
  };

  const fetchTableWindow = async (request: TableWindowRequest): Promise<Result<TableWindow, DomainError>> => {
    const connectionResult = requireConnection();

    if (!connectionResult.ok) {
      return connectionResult;
    }

    const relation = relations.get(request.datasetId);

    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }

    const limit = Math.min(Math.max(Math.trunc(request.limit) || 0, 0), MAX_TABLE_WINDOW_ROWS);
    const offset = Math.max(Math.trunc(request.offset) || 0, 0);
    const filters = enabledExpressions(request.filters);
    // Derived columns are virtual, so add their metadata before compiling the full projection.
    const derivedColumns = Object.values(derivedColumnDefinitions).filter(
      (column) => column.datasetId === request.datasetId,
    );
    const projectedColumns = [
      ...relation.columns,
      ...derivedColumns.map((column) => ({
        id: column.id,
        name: column.name,
        physicalName: '',
        databaseType: '',
        logicalType: column.logicalType,
        nullable: true,
      })),
    ];
    const compiled = compileAnalysisQuery(
      {
        datasetId: request.datasetId,
        dimensions: projectedColumns.map((column) => column.id),
        measures: [],
        filters,
        orderBy: request.sort ?? [],
        limit,
        offset,
      },
      queryContext(),
    );
    if (!compiled.ok) {
      return compiled;
    }
    const countKey = {
      datasetId: request.datasetId,
      datasetRevision: relation.revision,
      filters,
      limit: 1,
    };

    const scheduled = await scheduler
      .schedule(
        async () => {
          const table = await executeCompiled(connectionResult.value, compiled.value);
          let totalRowCount = countCache.get(countKey);
          if (totalRowCount === undefined) {
            const count = compileAnalysisQuery(
              {
                datasetId: request.datasetId,
                dimensions: [],
                measures: [{ aggregate: 'count', alias: 'count' }],
                filters,
                limit: 1,
              },
              queryDataset(request.datasetId, relation),
            );
            if (!count.ok) {
              throw new Error('Count compilation failed');
            }
            totalRowCount = readScalarCount(await executeCompiled(connectionResult.value, count.value));
            countCache.set(countKey, totalRowCount);
          }
          return {
            rows: readArrowRows(
              table,
              projectedColumns.map((column) => column.logicalType),
            ).rows,
            totalRowCount,
          };
        },
        {
          // Scope table-window supersession by dataset.
          key: `table-window:${request.datasetId}`,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      )
      .catch(() => null);

    if (scheduled === null) {
      return err(engineFailure('QUERY_FAILED'));
    }

    const columnIds = projectedColumns.map((column) => column.id);

    // Superseded reads are normal interaction; callers keep the current window.
    if (scheduled.stale) {
      return ok({ rows: [], columnIds, columns: compiled.value.resultColumns, totalRowCount: 0, offset, stale: true });
    }

    return ok({
      rows: scheduled.value.rows,
      columnIds,
      columns: compiled.value.resultColumns,
      totalRowCount: scheduled.value.totalRowCount,
      offset,
      stale: false,
    });
  };

  // Reads a column's numeric extent for equal-width binning.
  const getColumnRange = async (request: ColumnRangeRequest): Promise<Result<ColumnRange, DomainError>> => {
    const relation = relations.get(request.datasetId);

    // A filtered range cannot reuse the unfiltered cached extent.
    if (relation !== undefined && request.filters.length === 0) {
      const cached = statisticsCache.columnStatistics(request.columnId, relation.revision);

      if (cached?.min !== undefined && cached.max !== undefined) {
        return ok({ min: cached.min, max: cached.max });
      }
    }

    const result = await executeAnalysis({
      datasetId: request.datasetId,
      dimensions: [],
      measures: [
        { columnId: request.columnId, aggregate: 'min', alias: 'lo' },
        { columnId: request.columnId, aggregate: 'max', alias: 'hi' },
      ],
      filters: enabledExpressions(request.filters),
      limit: 1,
    });

    if (!result.ok) {
      return result;
    }

    const [row] = result.value.rows;
    const min = Number(row?.[0] ?? 0);
    const max = Number(row?.[1] ?? 0);

    // Use a zero-width range for empty or all-null columns.
    const range = { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };

    // Cache only unfiltered extents.
    if (relation !== undefined && request.filters.length === 0) {
      const existing = statisticsCache.columnStatistics(request.columnId, relation.revision);

      statisticsCache.setColumnStatistics(request.columnId, relation.revision, {
        distinctCount: existing?.distinctCount ?? 0,
        distinctCountCapped: existing?.distinctCountCapped ?? false,
        min: range.min,
        max: range.max,
      });
    }

    return ok(range);
  };

  // Profiles a physical or derived column with bounded aggregate queries.
  const getColumnStatistics = async (
    request: ColumnStatisticsRequest,
  ): Promise<Result<ColumnStatistics, DomainError>> => {
    const relation = relations.get(request.datasetId);

    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }

    const derived = derivedColumnDefinitions[request.columnId];
    const column =
      relation.columns.find((candidate) => candidate.id === request.columnId) ??
      (derived?.datasetId === request.datasetId
        ? {
            id: derived.id,
            name: derived.name,
            physicalName: '',
            databaseType: '',
            logicalType: derived.logicalType,
            nullable: true,
          }
        : undefined);

    if (column === undefined) {
      return err(domainError('COLUMN_NOT_FOUND', 'The statistics request references a column that does not exist.'));
    }

    const filters = enabledExpressions(request.filters);
    const numeric = column.logicalType === 'number';
    const temporal = column.logicalType === 'date' || column.logicalType === 'timestamp';
    const extrema = numeric || temporal;
    const measures: AnalysisQuery['measures'] = [
      { aggregate: 'count', alias: 'rows' },
      { columnId: column.id, aggregate: 'count', alias: 'nonNull' },
      { columnId: column.id, aggregate: 'count_distinct', alias: 'distinct' },
      ...(extrema
        ? ([
            { columnId: column.id, aggregate: 'min' as const, alias: 'lo' },
            { columnId: column.id, aggregate: 'max' as const, alias: 'hi' },
            ...(numeric
              ? [
                  { columnId: column.id, aggregate: 'avg' as const, alias: 'mean' },
                  { columnId: column.id, aggregate: 'median' as const, alias: 'median' },
                  { columnId: column.id, aggregate: 'stddev' as const, alias: 'stddev' },
                ]
              : []),
          ] satisfies AnalysisQuery['measures'])
        : []),
    ];

    const summary = await executeAnalysis({
      datasetId: request.datasetId,
      dimensions: [],
      measures,
      filters,
      limit: 1,
    });

    if (!summary.ok) {
      return summary;
    }

    const [row] = summary.value.rows;
    const rowCount = Number(row?.[0] ?? 0);
    const nonNull = Number(row?.[1] ?? 0);
    const distinctCount = Number(row?.[2] ?? 0);
    // Convert temporal extrema to ISO strings for the data-engine port.
    const temporalBound = (value: unknown): string => {
      const date = new Date(typeof value === 'number' ? value : Number(value));
      if (Number.isNaN(date.getTime())) {
        return String(value ?? '');
      }
      return column.logicalType === 'date' ? date.toISOString().slice(0, 10) : date.toISOString();
    };

    // Cache exact statistics for this dataset revision.
    statisticsCache.setColumnStatistics(column.id, relation.revision, {
      distinctCount: Math.min(distinctCount, DISTINCT_COUNT_CAP),
      distinctCountCapped: distinctCount > DISTINCT_COUNT_CAP,
      ...(numeric ? { min: Number(row?.[3] ?? 0), max: Number(row?.[4] ?? 0) } : {}),
    });

    const statistics: ColumnStatistics = {
      rowCount,
      nullCount: Math.max(rowCount - nonNull, 0),
      distinctCount: Math.min(distinctCount, DISTINCT_COUNT_CAP),
      distinctCountCapped: distinctCount > DISTINCT_COUNT_CAP,
      ...(extrema
        ? {
            min: numeric ? Number(row?.[3] ?? 0) : temporalBound(row?.[3]),
            max: numeric ? Number(row?.[4] ?? 0) : temporalBound(row?.[4]),
            ...(numeric
              ? {
                  mean: Number(row?.[5] ?? 0),
                  median: Number(row?.[6] ?? 0),
                  stddev: Number(row?.[7] ?? 0),
                }
              : {}),
          }
        : {}),
    };

    if (!numeric) {
      const limit = Math.min(Math.max(Math.trunc(request.topValueLimit ?? 10), 1), MAX_TOP_VALUES);
      const top = await getDistinctValues({
        datasetId: request.datasetId,
        columnId: column.id,
        filters: request.filters,
        limit,
      });

      if (top.ok) {
        statistics.topValues = top.value.values.map((entry) => ({
          value: typeof entry.value === 'string' ? entry.value.slice(0, MAX_STATISTIC_STRING_LENGTH) : entry.value,
          count: entry.count,
        }));
      }
    }

    return ok(statistics);
  };

  const getDistinctValues = async (
    request: DistinctValuesRequest,
  ): Promise<Result<DistinctValuesResult, DomainError>> => {
    const limit = Math.min(Math.max(Math.trunc(request.limit ?? 200), 1), 200);
    const result = await executeAnalysis({
      datasetId: request.datasetId,
      dimensions: [request.columnId],
      measures: [{ aggregate: 'count', alias: 'count' }],
      filters: enabledExpressions(request.filters),
      orderBy: [{ measureAlias: 'count', direction: 'desc' }],
      limit: limit + 1,
    });
    if (!result.ok) {
      return result;
    }
    return ok({
      values: result.value.rows.slice(0, limit).map((row) => ({ value: row[0] ?? null, count: Number(row[1] ?? 0) })),
      truncated: result.value.rows.length > limit,
    });
  };

  const initialize = (): Promise<Result<void, DomainError>> => {
    if (handle !== null) {
      return Promise.resolve(ok(undefined));
    }

    // Share initialization so the tab owns one worker and Wasm heap.
    initializing ??= openDuckDB()
      .then((opened): Result<void, DomainError> => {
        handle = opened;

        return ok(undefined);
      })
      .catch((): Result<void, DomainError> => {
        initializing = null;

        return err(
          domainError('ENGINE_UNAVAILABLE', 'The analytical engine could not start in this browser.', {
            retryable: true,
          }),
        );
      });

    return initializing;
  };

  const dispose = async (): Promise<void> => {
    scheduler.abortAll();
    relations.clear();
    relationshipGraph.clear();
    countCache.clear();
    statisticsCache.clear();

    const opened = handle;

    handle = null;
    initializing = null;

    if (opened !== null) {
      await closeDuckDB(opened);
    }
  };

  return {
    initialize,
    importFile,
    fetchTableWindow,
    executeAnalysis,
    getDistinctValues,
    getColumnStatistics,
    getColumnRange,
    measureKeyQuality,
    dropDataset,
    dispose,
    setRelationships: (relationships) => {
      relationshipGraph.clear();
      for (const relationship of Object.values(relationships)) {
        relationshipGraph.set(relationship.id, relationship);
      }
    },
    setDerivedColumns: (columns) => {
      derivedColumnDefinitions = columns;
    },
  };
};

// Shared application engine instance for this browser tab.
export const dataEngine = createDataEngine();
