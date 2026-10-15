import { Component, type ErrorInfo, type ReactNode } from 'react';
import { messages } from './messages.ru';

type State = { failed: boolean };

export class GameErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Game initialization failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="game-shell">
      <section className="screen-card" role="alert">
        <p className="eyebrow">{messages.gameStartupFailedEyebrow}</p>
        <h1>{messages.unableToOpenGameHeading}</h1>
        <p className="instruction">{messages.reloadAndRetryInstruction}</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>{messages.reloadPageButton} <span>{messages.reloadGlyph}</span></button>
      </section>
    </main>;
  }
}
