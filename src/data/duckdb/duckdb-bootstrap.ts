import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import { databasePath, type DatabaseStorage } from '@/data/persistence/opfs-database.ts';

/**
 * Brings up DuckDB-Wasm in a worker.
 *
 * This module and `data-engine.ts` are the only places permitted to import `@duckdb/duckdb-wasm`;
 * the boundary is enforced by `tests/unit/architecture/engine-boundary.test.ts`.
 */

/**
 * Self-hosted bundles resolved from `node_modules` at build time.
 *
 * `getJsDelivrBundles()` is deliberately not used. It would fetch the Wasm module and worker from a
 * CDN on first import, which contradicts the local-first requirement that the application make no
 * unnecessary third-party requests, and would make the app unusable offline. Vite's `?url` imports
 * emit these as hashed same-origin assets instead.
 *
 * Only `mvp` and `eh` are offered. The threaded `coi` bundle needs COOP/COEP response headers on
 * every deployment, which break cross-origin assets and embeds and have not been verified against
 * WebMCP tool registration. The benchmark evidence that would justify that cost does not exist, so
 * threading stays unshipped — see `docs/decisions/0015-threaded-duckdb.md` for what would reopen it.
 */
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

export interface DuckDBHandle {
  database: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
  worker: Worker;
}

/**
 * Statements applied to every connection.
 *
 * Research §DuckDB security policy, in the order the risks matter:
 *
 * - Extension autoinstall and autoload are the only routes by which running a query could pull code
 *   over the network. Both are disabled, and the community repository is never contacted.
 * - `enable_external_access` is **left enabled** deliberately. DuckDB-Wasm's registered-file
 *   ingestion goes through the same external-access gate as HTTP and S3 reads, so disabling it also
 *   disables the local-file import this application is built around. The protection that setting
 *   would provide is instead obtained structurally: no HTTP or S3 path can be reached because the
 *   query compiler is the only code that emits SQL, it emits identifiers exclusively through
 *   `quoteIdentifier`, and no agent or user string ever becomes SQL text. See
 *   `docs/decisions/0003-no-agent-sql.md`.
 */
const SECURITY_STATEMENTS: readonly string[] = [
  'SET autoinstall_known_extensions = false',
  'SET autoload_known_extensions = false',
  'SET allow_community_extensions = false',
];

/**
 * No extension is ever loaded.
 *
 * Measured, not assumed: `LOAD json` issues a request to `extensions.duckdb.org` — DuckDB-Wasm
 * reports the extension as `installed: false`, so `LOAD` fetches it over the network. That would
 * be a third-party request on the import path and would make JSON import fail offline, both of
 * which the local-first requirement forbids.
 *
 * JSON is therefore parsed in JavaScript and handed to the CSV reader instead, which is built in.
 * See `json-to-csv.ts`.
 */
const REQUIRED_EXTENSIONS: readonly string[] = [];

export const openDuckDB = async (storage: DatabaseStorage = 'opfs'): Promise<DuckDBHandle> => {
  const bundle = await duckdb.selectBundle(BUNDLES);

  if (bundle.mainWorker === null) {
    throw new Error('DuckDB selected a bundle without a worker; the browser is unsupported.');
  }

  const worker = new Worker(bundle.mainWorker, { type: 'module' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const database = new duckdb.AsyncDuckDB(logger, worker);

  await database.instantiate(bundle.mainModule, bundle.pthreadWorker);

  await database.open({
    path: databasePath(storage),
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
    query: {
      /**
       * Integers stay `BIGINT` rather than being cast to double on the way out. The conversion
       * layer decides what to do with values beyond JavaScript's safe range; casting here would
       * lose those digits before it ever got the chance.
       */
      castBigIntToDouble: false,
    },
  });

  const connection = await database.connect();

  // Applied one at a time rather than with `Promise.all`: these run on a single connection, which
  // DuckDB executes sequentially anyway, and a failure must stop the remaining ones rather than
  // leaving the connection partially configured.
  //
  // Order matters. The security settings come first so that autoload is already off before any
  // extension is named, which keeps the explicit `LOAD` below the only way one can arrive.
  for (const statement of [...SECURITY_STATEMENTS, ...REQUIRED_EXTENSIONS.map((name) => `LOAD ${name}`)]) {
    // eslint-disable-next-line no-await-in-loop -- see above
    await connection.query(statement);
  }

  return { database, connection, worker };
};

/**
 * Shuts DuckDB down.
 *
 * Each step is independent: a failure closing the connection must not leave the worker running,
 * since an orphaned worker keeps its entire Wasm heap alive for the life of the tab.
 */
export const closeDuckDB = async (handle: DuckDBHandle): Promise<void> => {
  try {
    await handle.connection.close();
  } finally {
    try {
      await handle.database.terminate();
    } finally {
      handle.worker.terminate();
    }
  }
};
