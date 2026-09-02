import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

// Initializes DuckDB-Wasm in a worker.

/**
 * Resolves self-hosted DuckDB-Wasm assets from `node_modules`.
 *
 * CDN bundles would add a network dependency. The threaded bundle is not enabled because its
 * COOP/COEP requirements are not verified for every deployment.
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
 * Configures every connection.
 *
 * Disable extension autoinstall and autoload. Keep external access enabled because registered local
 * files use the same gate.
 */
const SECURITY_STATEMENTS: readonly string[] = [
  'SET autoinstall_known_extensions = false',
  'SET autoload_known_extensions = false',
  'SET allow_community_extensions = false',
];

// Opens the in-memory analytical database.
export const openDuckDB = async (): Promise<DuckDBHandle> => {
  const bundle = await duckdb.selectBundle(BUNDLES);

  if (bundle.mainWorker === null) {
    throw new Error('DuckDB selected a bundle without a worker; the browser is unsupported.');
  }

  const worker = new Worker(bundle.mainWorker, { type: 'module' });
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const database = new duckdb.AsyncDuckDB(logger, worker);

  await database.instantiate(bundle.mainModule, bundle.pthreadWorker);

  await database.open({
    path: ':memory:',
    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
    query: {
      // Keep integer columns as `BIGINT` until conversion checks their safe range.
      castBigIntToDouble: false,
    },
  });

  const connection = await database.connect();

  // Apply settings sequentially so a failure stops configuration on this connection. No extension
  // is loaded here: JSON import stays extension-free because loading one would make a network request.
  for (const statement of SECURITY_STATEMENTS) {
    // eslint-disable-next-line no-await-in-loop -- connection settings are sequential.
    await connection.query(statement);
  }

  return { database, connection, worker };
};

// Closes DuckDB resources without leaving the worker running.
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
