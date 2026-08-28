import { selectEngineError, selectEngineStatus, useEngineStatus } from '@/state/use-engine-status.ts';

/**
 * Reports whether the analytical engine started.
 *
 * DuckDB-Wasm takes a moment to instantiate and can fail outright on a browser without the Wasm
 * features it needs. Both states are shown rather than left implicit, because a silently missing
 * engine looks identical to an application that has simply stopped responding to the import button.
 */
export const EngineStatusBanner = (): React.JSX.Element | null => {
  const status = useEngineStatus(selectEngineStatus);
  const error = useEngineStatus(selectEngineError);

  if (status === 'ready') return null;

  if (status === 'failed') {
    return (
      <div className="engine-status engine-status--failed" role="alert">
        {error?.message ?? 'The analytical engine could not start in this browser.'}
      </div>
    );
  }

  return (
    <div className="engine-status" role="status">
      Starting the analytical engine…
    </div>
  );
};
