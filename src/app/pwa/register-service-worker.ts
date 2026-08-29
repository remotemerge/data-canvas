/**
 * Registers the service worker and reports when an update is waiting.
 *
 * The worker never activates itself. A new build's assets are hash-named, so a worker that took
 * over mid-session could serve a chunk the loaded application does not expect — the classic
 * version-skew failure. Instead the page is told an update is ready and the user decides when to
 * reload.
 */

export type ServiceWorkerUpdateListener = (applyUpdate: () => void) => void;

/** Registration is skipped in development, where hot reload and a caching worker fight each other. */
const shouldRegister = (): boolean => import.meta.env.PROD && 'serviceWorker' in navigator;

/*
 * `ServiceWorker.postMessage` takes no target origin — that parameter belongs to
 * `Window.postMessage`. The message reaches only this registration's worker, which is same-origin by
 * definition, so there is no cross-origin target to constrain.
 */
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const applyUpdate = (worker: ServiceWorker) => (): void => worker.postMessage({ type: 'SKIP_WAITING' });

export const registerServiceWorker = (onUpdateReady: ServiceWorkerUpdateListener): void => {
  if (!shouldRegister()) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        // A worker already waiting when the page loads: the user opened a tab after a deploy.
        if (registration.waiting !== null) onUpdateReady(applyUpdate(registration.waiting));

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;

          if (installing === null) return;

          installing.addEventListener('statechange', () => {
            // `controller` distinguishes an update from the very first install. On a first install
            // there is nothing to replace, so prompting would be noise.
            if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
              onUpdateReady(applyUpdate(installing));
            }
          });
        });
      })
      .catch(() => {
        // A failed registration costs offline support but must never break the application.
      });
  });

  let reloading = false;

  // Fires once the new worker takes control, which is the point at which a reload is safe.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
};
