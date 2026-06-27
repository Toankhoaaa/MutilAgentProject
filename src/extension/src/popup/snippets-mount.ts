import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';

const el = document.getElementById('snippets-root');
if (el) createRoot(el).render(createElement(PopupApp));
