import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

// StrictMode is ON in dev — the whole point of the r3f-box3d lifecycle work is
// surviving React's dev double-mount. Leaving it on here is the proof.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
