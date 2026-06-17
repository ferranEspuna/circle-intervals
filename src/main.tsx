import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../circle_group_visualizer';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
