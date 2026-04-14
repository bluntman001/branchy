import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';

const container = document.getElementById('root');
if (!container) throw new Error('No #root element found');
const root = createRoot(container);
root.render(React.createElement(App));
