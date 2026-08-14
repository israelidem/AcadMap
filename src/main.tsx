import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui';
import { ServiceWorkerBanner } from './components/pwa';
import { syncOwnerRole } from './lib/auth';
import { startSync } from './lib/sync';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// Before the first render, so the admin entry point is correct on the very first
// paint even for an account created before the owner address was configured.
syncOwnerRole();

/*
 * Cross-device sync runs for the life of the tab, outside React, so it is not
 * restarted by re-renders or tied to any one screen. It does nothing while
 * signed out, which is also what makes it safe to start before the first paint:
 * a guest is never touched, and a returning student's other-device work is
 * already on its way in.
 */
startSync();


createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
          <ServiceWorkerBanner />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
