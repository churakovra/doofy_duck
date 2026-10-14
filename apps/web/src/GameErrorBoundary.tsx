import { Component, type ErrorInfo, type ReactNode } from 'react';

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
        <p className="eyebrow">ИГРА НЕ ЗАПУСТИЛАСЬ</p>
        <h1>Не удалось открыть игру</h1>
        <p className="instruction">Обнови страницу и попробуй ещё раз.</p>
        <button className="primary-button" type="button" onClick={() => window.location.reload()}>Обновить страницу <span>↻</span></button>
      </section>
    </main>;
  }
}
