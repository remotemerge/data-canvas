import { useEffect, useState } from 'react';
import { registerServiceWorker } from '@/app/pwa/register-service-worker.ts';

/**
 * Offers a reload when a new build has been cached.
 *
 * The service worker deliberately does not activate on its own, so this prompt is the only path to
 * an update. Applying it reloads the page, which discards nothing durable — the workspace is
 * checkpointed — but is still the user's choice rather than an interruption mid-analysis.
 */
export const UpdatePrompt = (): React.JSX.Element | null => {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    // Stored as a thunk: `setState` would otherwise call the function it was handed.
    registerServiceWorker((apply) => setApplyUpdate(() => apply));
  }, []);

  if (applyUpdate === null) return null;

  return (
    <div className="update-prompt" role="status">
      <span>A new version of Data Canvas is ready.</span>
      <button type="button" onClick={applyUpdate}>
        Reload
      </button>
      <button type="button" onClick={() => setApplyUpdate(null)}>
        Later
      </button>
    </div>
  );
};
