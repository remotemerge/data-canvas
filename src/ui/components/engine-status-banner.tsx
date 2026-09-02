import { selectEngineError, selectEngineStatus, useEngineStatus } from '@/state/use-engine-status.ts';

// Reports analytical-engine startup and failure state.
export const EngineStatusBanner = (): React.JSX.Element | null => {
  const status = useEngineStatus(selectEngineStatus);
  const error = useEngineStatus(selectEngineError);

  if (status === 'ready') {
    return null;
  }

  if (status === 'failed') {
    return (
      <div className="engine-status engine-status--failed" role="alert">
        {error?.message ?? 'The analytical engine could not start in this browser.'}
      </div>
    );
  }

  return <output className="engine-status">Starting the analytical engine…</output>;
};
