import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui';
import { ServiceWorkerBanner } from './components/pwa';
import { syncOwnerRole } from './lib/auth';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// Before the first render, so the admin entry point is correct on the very first
// paint even for an account created before the owner address was configured.
syncOwnerRole();

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
