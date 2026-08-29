/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from 'virtual:pwa-register';

export type ServiceWorkerUpdateListener = (applyUpdate: () => void) => void;

export const registerServiceWorker = (onUpdateReady: ServiceWorkerUpdateListener): void => {
  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      onUpdateReady(() => void updateServiceWorker(true));
    },
  });
};
