import React from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './Game';
import { GameErrorBoundary } from './GameErrorBoundary';
import { LocaleProvider } from './locale';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LocaleProvider><GameErrorBoundary><Game /></GameErrorBoundary></LocaleProvider></React.StrictMode>);
