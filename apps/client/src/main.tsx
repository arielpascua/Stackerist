import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createCoreServices } from './game/core.ts';
import { createBrowserDevice } from './ui/browser.ts';
import { createBrowserRouter } from './ui/router.ts';

// The one place concrete CORE modules meet the UI (architecture §5.1): everything below receives
// them through `CoreServices`, typed by game/contract.ts.
const services = createCoreServices();
const router = createBrowserRouter(window);
const device = createBrowserDevice(window);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App services={services} router={router} device={device} />
  </StrictMode>,
);
