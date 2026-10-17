import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { applyTheme, watchSystemTheme } from './theme.js';

// theme-init.js already set the theme before paint; keep it in sync and
// follow the OS in "system" mode.
applyTheme();
watchSystemTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
