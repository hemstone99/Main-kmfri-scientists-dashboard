import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {markServiceWorkerRegistered} from './services/offlineSyncService.ts';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (scriptUrl.includes('dev-sw.js')) {
          await reg.unregister();
        }
      }
      const registration = await navigator.serviceWorker.register('/sw-offline.js', { scope: '/' });
      markServiceWorkerRegistered(Boolean(registration));
    } catch {
      markServiceWorkerRegistered(false);
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
