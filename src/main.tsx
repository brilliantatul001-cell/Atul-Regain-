import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker
      .getRegistrations()
      .then(async (regs) => {
        for (const r of regs) {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
          if (url && !url.endsWith('/sw-notify.js')) {
            await r.unregister();
          }
        }
        await navigator.serviceWorker.register('/sw-notify.js', {scope: '/'});
      })
      .catch(() => {});
  } else {
    registerSW({immediate: true});
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
