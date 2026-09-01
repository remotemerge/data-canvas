import { useEffect, useState } from 'react';
import { registerServiceWorker } from '@/app/pwa/register-service-worker.ts';

// Offers a reload when a new build is ready.
export const UpdatePrompt = (): React.JSX.Element | null => {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    // Store a thunk so setState does not invoke the reload callback.
    registerServiceWorker((apply) => setApplyUpdate(() => apply));
  }, []);

  if (applyUpdate === null) {
    return null;
  }

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
