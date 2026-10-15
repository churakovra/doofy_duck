import { GameButton } from './GameButton';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocale } from './locale';
import type { MessageCatalog } from './messages.ru';

type State = { failed: boolean };

class ErrorBoundary extends Component<{ children: ReactNode; messages: MessageCatalog }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Game initialization failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="game-shell">
      <section className="screen-card" role="alert">
        <p className="eyebrow">{this.props.messages.gameStartupFailedEyebrow}</p>
        <h1>{this.props.messages.unableToOpenGameHeading}</h1>
        <p className="instruction">{this.props.messages.reloadAndRetryInstruction}</p>
        <GameButton variant="primary" onClick={() => window.location.reload()}>{this.props.messages.reloadPageButton} <span>{this.props.messages.reloadGlyph}</span></GameButton>
      </section>
    </main>;
  }
}

export function GameErrorBoundary({ children }: { children: ReactNode }) {
  const { messages } = useLocale();
  return <ErrorBoundary messages={messages}>{children}</ErrorBoundary>;
}
