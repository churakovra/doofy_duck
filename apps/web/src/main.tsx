import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountGame } from './AccountGame';
import { GameErrorBoundary } from './GameErrorBoundary';
import { LocaleProvider } from './locale';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LocaleProvider><GameErrorBoundary><AccountGame /></GameErrorBoundary></LocaleProvider></React.StrictMode>);
