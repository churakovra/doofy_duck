import React from 'react';
import { createRoot } from 'react-dom/client';
import { Game } from './Game';
import { GameErrorBoundary } from './GameErrorBoundary';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><GameErrorBoundary><Game /></GameErrorBoundary></React.StrictMode>);
