import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import type {
  AnalysisResult,
  DataEnginePort,
  DistinctValuesRequest,
  DistinctValuesResult,
  ImportedRelation,
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
import { createQueryScheduler } from '@/data/duckdb/query-scheduler.ts';
import type { QueryScheduler } from '@/data/duckdb/query-scheduler.ts';
import { ingestionFailure, validateColumnCount, validateImportFile } from '@/data/import/import-dataset.ts';
import type { ValidatedFile } from '@/data/import/import-dataset.ts';
import { jsonToCsvBytes } from '@/data/import/json-to-csv.ts';
import { MAX_TABLE_WINDOW_ROWS } from '@/data/import/import-limits.ts';
import type { AnalysisQuery } from '@/domain/analysis/analysis-query.ts';
import type { Column } from '@/domain/dataset/dataset.ts';
import type { Filter } from '@/domain/filter/filter.ts';
import { domainError } from '@/shared/errors/domain-error.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import { createEntityId, ID_PREFIX } from '@/shared/ids/entity-id.ts';
import type { EntityId } from '@/shared/ids/entity-id.ts';
import { err, ok } from '@/shared/result/result.ts';
import type { Result } from '@/shared/result/result.ts';

/**
 * The DuckDB-Wasm implementation of `DataEnginePort`.
 *
 * Containment invariant. The connection object never leaves this module — no React component, no
 * WebMCP handler, and no domain file may hold one. Everything crossing the boundary is a domain
 * type. `tests/unit/architecture/engine-boundary.test.ts` enforces that `@duckdb/duckdb-wasm` is
 * imported nowhere outside `src/data/duckdb/`.
 *
 * One connection plus a scheduler, not a pool: DuckDB-Wasm executes queries sequentially per
 * connection, so a pool would add lifecycle complexity without buying concurrency.
 */

/** What the engine remembers about an imported dataset. Rows are never held here — only in DuckDB. */
interface RelationEntry {
  relationName: string;
  columns: Column[];
  revision: number;
}

/** One row of DuckDB's `DESCRIBE` output. Only the two fields the engine uses are declared. */
interface DescribedColumn {
  column_name: unknown;
  column_type: unknown;
  null: unknown;
}

export interface DataEngine extends DataEnginePort {
  initialize(): Promise<Result<void, DomainError>>;
  dispose(): Promise<void>;
}

/**
 * Wraps engine work so a DuckDB exception becomes a typed failure.
 *
 * The thrown message is deliberately discarded: DuckDB quotes offending input in parse and
 * constraint errors, and dataset content must not reach an error that surfaces in the UI or
 * crosses to an agent.
 */
const engineFailure = (code: 'QUERY_FAILED' | 'IMPORT_FAILED'): DomainError =>
  code === 'IMPORT_FAILED'
    ? ingestionFailure()
    : domainError('QUERY_FAILED', 'The query could not be completed against the imported data.');

/**
 * Reads a relation's schema.
 *
 * `DESCRIBE` rather than `information_schema`: it reports the resolved type of every column in
 * relation order in one round trip, which is exactly the ordering the positional rename depends on.
 */
const describeRelation = async (
  connection: AsyncDuckDBConnection,
  relationName: string,
): Promise<DescribedColumn[]> => {
  const described = await connection.query(`DESCRIBE ${quoteIdentifier(relationName)}`);

  return described.toArray() as unknown as DescribedColumn[];
};

/**
 * Counts distinct values in a text column, stopping just past the category threshold.
 *
 * The subquery's `LIMIT` is what keeps this cheap: DuckDB stops after finding one more distinct
 * value than could possibly still qualify, so a column with a million distinct values costs the
 * same as one with fifty. Without it this would be a full scan per text column on every import.
 */
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
 * Rewrites the staging relation into the canonical one with generated column names.
 *
 * This is the step that makes header text structurally harmless. A CTAS column-alias list assigns
 * every column a positional name, so no header — duplicated, unicode-only, or containing
 * `"; DROP TABLE x` — is ever quoted into SQL or used as an identifier. Renaming in place with
 * `ALTER TABLE ... RENAME COLUMN` would have required quoting the original name to name it.
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

/**
 * Builds domain columns from a described relation.
 *
 * `name` keeps the file's original header as display text; `physicalName` is the generated
 * positional identifier the relation actually uses. Separating them is what lets a duplicate or
 * unquotable header be shown verbatim to the user while SQL references something safe.
 */
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

    // Sequential by necessity, not oversight: these share one DuckDB connection, which executes
    // queries one at a time regardless. Only text columns can be categorical, so only they pay.
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
      // DuckDB reports nullability as 'YES'/'NO'; anything unexpected is treated as nullable,
      // which is the safe direction — it never claims a column cannot contain nulls.
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

const executeCompiled = async (connection: AsyncDuckDBConnection, compiled: CompiledQuery): Promise<ArrowRowSource> => {
  const statement = await connection.prepare(compiled.sql);
  try {
    return (await statement.query(...compiled.parameters)) as unknown as ArrowRowSource;
  } finally {
    await statement.close();
  }
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

  /** Relation metadata by dataset ID. Rebuilt per session; the workspace store holds the durable copy. */
  const relations = new Map<EntityId, RelationEntry>();
  const countCache = createQueryCache<number>();

  const requireConnection = (): Result<AsyncDuckDBConnection, DomainError> =>
    handle === null
      ? err(domainError('ENGINE_UNAVAILABLE', 'The analytical engine is not available yet.'))
      : ok(handle.connection);

  /**
   * Ingests the validated file into a staging relation.
   *
   * The file is registered as a buffer under a path derived from the *generated* relation name, not
   * from its own filename: the virtual filesystem path is another place a hostile filename could
   * otherwise land.
   *
   * Both formats reach DuckDB through the built-in CSV reader. JSON is converted to CSV in
   * JavaScript first, because DuckDB's JSON reader lives in an extension that `LOAD` fetches over
   * the network — see `json-to-csv.ts`. Keeping one ingestion path also means the delimiter,
   * header, and sniffer settings are configured in exactly one place.
   */
  const ingestStaging = async (
    connection: AsyncDuckDBConnection,
    validated: ValidatedFile,
    stagingName: string,
  ): Promise<readonly string[]> => {
    const raw = new Uint8Array(await validated.file.arrayBuffer());
    const isJson = validated.sourceKind === 'json';
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
        // The converter always emits comma-delimited output, so a source delimiter applies only to
        // files read verbatim.
        ...(isJson || validated.delimiter === undefined ? {} : { delimiter: validated.delimiter }),
      });

      const staged = await describeRelation(connection, stagingName);

      return staged.map((entry) => String(entry.column_name ?? ''));
    } finally {
      // The buffer is a full copy of the file. Dropping it immediately after ingestion keeps a
      // second copy of every imported dataset from living in worker memory for the session.
      await handle?.database.dropFile(virtualPath).catch(() => undefined);
    }
  };

  const importFile = async (file: unknown, datasetId: EntityId): Promise<Result<ImportedRelation, DomainError>> => {
    const connectionResult = requireConnection();

    if (!connectionResult.ok) return connectionResult;

    const validated = validateImportFile(file);

    if (!validated.ok) return validated;

    const connection = connectionResult.value;
    const relationName = createRelationName(datasetId);
    const stagingName = stagingRelationName(relationName);

    try {
      const displayNames = await ingestStaging(connection, validated.value, stagingName);

      const columnCount = validateColumnCount(displayNames.length);

      if (!columnCount.ok) {
        await dropRelation(connection, stagingName);

        return columnCount;
      }

      await materializeRelation(connection, stagingName, relationName, displayNames.length);
      await dropRelation(connection, stagingName);

      const described = await describeRelation(connection, relationName);
      const columns = await buildColumns(connection, relationName, described, displayNames);

      const counted = await connection.query(`SELECT count(*) FROM ${quoteIdentifier(relationName)}`);
      const rowCount = readScalarCount(counted as unknown as ArrowRowSource);

      const revision = (relations.get(datasetId)?.revision ?? 0) + 1;
      relations.set(datasetId, { relationName, columns, revision });
      countCache.clear();

      return ok({ relationId: relationName, rowCount, columns });
    } catch {
      // Both relations are dropped so a failed import leaves nothing half-created behind.
      await dropRelation(connection, stagingName);
      await dropRelation(connection, relationName);

      return err(engineFailure('IMPORT_FAILED'));
    }
  };

  /**
   * Reads a bounded window of rows.
   *
   * `limit` is clamped inside the engine rather than trusted from the caller, so no path — human or
   * agent — can request an unbounded read. Offset and limit are inlined as integers rather than
   * bound as parameters because DuckDB does not accept placeholders in `LIMIT`/`OFFSET`; they are
   * coerced through `Math.trunc` and clamped, so no caller-controlled text reaches the SQL.
   */
  const executeAnalysis = async (query: AnalysisQuery): Promise<Result<AnalysisResult, DomainError>> => {
    const connectionResult = requireConnection();
    if (!connectionResult.ok) return connectionResult;
    const relation = relations.get(query.datasetId);
    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }
    const compiled = compileAnalysisQuery(query, queryDataset(query.datasetId, relation));
    if (!compiled.ok) return compiled;
    try {
      const table = await executeCompiled(connectionResult.value, compiled.value);
      return ok({
        rows: readArrowRows(
          table,
          compiled.value.resultColumns.map((column) => column.logicalType),
        ).rows,
        columns: compiled.value.resultColumns,
      });
    } catch {
      return err(engineFailure('QUERY_FAILED'));
    }
  };

  const fetchTableWindow = async (request: TableWindowRequest): Promise<Result<TableWindow, DomainError>> => {
    const connectionResult = requireConnection();

    if (!connectionResult.ok) return connectionResult;

    const relation = relations.get(request.datasetId);

    if (relation === undefined) {
      return err(domainError('DATASET_NOT_FOUND', 'That dataset has not been imported into this session.'));
    }

    const limit = Math.min(Math.max(Math.trunc(request.limit) || 0, 0), MAX_TABLE_WINDOW_ROWS);
    const offset = Math.max(Math.trunc(request.offset) || 0, 0);
    const filters = enabledExpressions(request.filters);
    const compiled = compileAnalysisQuery(
      {
        datasetId: request.datasetId,
        dimensions: [],
        measures: [],
        filters,
        orderBy: request.sort ?? [],
        limit,
        offset,
      },
      queryDataset(request.datasetId, relation),
    );
    if (!compiled.ok) return compiled;
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
            if (!count.ok) throw new Error('Count compilation failed');
            totalRowCount = readScalarCount(await executeCompiled(connectionResult.value, count.value));
            countCache.set(countKey, totalRowCount);
          }
          return {
            rows: readArrowRows(
              table,
              relation.columns.map((column) => column.logicalType),
            ).rows,
            totalRowCount,
          };
        },
        {
          // Keyed per dataset so a window read for one dataset never supersedes another's.
          key: `table-window:${request.datasetId}`,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      )
      .catch(() => null);

    if (scheduled === null) return err(engineFailure('QUERY_FAILED'));

    const columnIds = relation.columns.map((column) => column.id);

    // A superseded read returns no rows rather than an error: being overtaken by a newer request
    // is normal interaction, and the caller simply keeps what it already shows.
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
    if (!result.ok) return result;
    return ok({
      values: result.value.rows.slice(0, limit).map((row) => ({ value: row[0] ?? null, count: Number(row[1] ?? 0) })),
      truncated: result.value.rows.length > limit,
    });
  };

  const initialize = (): Promise<Result<void, DomainError>> => {
    if (handle !== null) return Promise.resolve(ok(undefined));

    // Concurrent callers share one instantiation. Two `openDuckDB` calls would each spawn a worker
    // and a Wasm heap, and the second would silently orphan the first.
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
    countCache.clear();

    const opened = handle;

    handle = null;
    initializing = null;

    if (opened !== null) await closeDuckDB(opened);
  };

  return { initialize, importFile, fetchTableWindow, executeAnalysis, getDistinctValues, dispose };
};

/**
 * The application's engine instance.
 *
 * A module singleton because a browser tab holds exactly one DuckDB worker. It starts uninitialized
 * and stays so until bootstrap calls `initialize`, which is why the port's methods all fail with
 * `ENGINE_UNAVAILABLE` rather than throwing when called too early.
 */
export const dataEngine = createDataEngine();
