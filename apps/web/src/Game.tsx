import { GameCanvas } from './GameCanvas';
import { useGameAudio } from './useGameAudio';
import { useGameProgress } from './useGameProgress';
import { useGameRun } from './useGameRun';

export function Game() {
  const progress = useGameProgress();
  const audio = useGameAudio();
  const run = useGameRun(progress.canPlay, {
    onFlapUnlock: audio.unlockFromGesture,
    onFlap: audio.flap,
    onPickup: audio.pickup,
    onPhaseChange: audio.setPhase,
    onRunEnded: progress.settleRun,
  });

  const start = () => {
    audio.unlockFromGesture();
    run.start();
  };
  const restart = () => {
    progress.refreshBest();
    run.restart();
  };
  const busy = progress.walletSessionStatus === 'pending' || progress.walletSessionStatus === 'busy';

  return <main className="game-shell" onPointerDown={run.onFieldPointerDown} onPointerUp={run.onFieldPointerUp}>
    <div className="stage" aria-label="Игровое поле">
      <GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} />
    </div>
    <header className="hud" aria-live="polite">
      <div className="brand"><span className="brand-mark">✦</span><span>DOOFY<br />DUCK</span></div>
      <div className="score-card"><span>СЧЁТ</span><strong>{run.score}</strong></div>
      <div className="best-card"><span>РЕКОРД</span><strong>{progress.best}</strong></div>
      <button className="pause-button" type="button" aria-label="Пауза" onPointerDown={(event) => event.stopPropagation()} onClick={run.pause} disabled={run.phase !== 'RUNNING' || Boolean(run.runtimeError)}>Ⅱ</button>
    </header>
    <footer className="wallet-strip" aria-label="Локальный игровой кошелёк">
      <div className="wallet-total"><span className="token feather">✦</span><span>Перья · всего</span><strong>{progress.wallet.FEATHER}</strong></div>
      <div className="wallet-total"><span className="token star">★</span><span>Game Star · всего</span><strong>{progress.wallet.GAME_STAR}</strong></div>
      <p className={`wallet-storage ${progress.walletPersistent ? '' : 'not-saved'}`}>{progress.walletPersistent ? 'Кошелёк на этом устройстве' : progress.walletSessionStatus === 'busy' ? 'Кошелёк занят в другой вкладке · закрой её и перезагрузи эту страницу' : progress.walletSessionStatus === 'pending' ? 'Проверяем доступ к кошельку…' : 'Только в памяти · кошелёк не сохраняется на этом устройстве'}</p>
      <p className="wallet-local-note">Локальные игровые единицы · Game Star ≠ Telegram XTR</p>
    </footer>
    <nav className="audio-controls" aria-label="Настройки звука">
      <button type="button" aria-pressed={audio.preferences.sound} onPointerDown={(event) => event.stopPropagation()} onClick={() => audio.toggle('sound')}>{audio.preferences.sound ? 'Звук: вкл.' : 'Звук: выкл.'}</button>
      <button type="button" aria-pressed={audio.preferences.music} onPointerDown={(event) => event.stopPropagation()} onClick={() => audio.toggle('music')}>{audio.preferences.music ? 'Музыка: вкл.' : 'Музыка: выкл.'}</button>
    </nav>
    {run.phase !== 'RUNNING' && <section className={`screen-card ${run.phase.toLowerCase()}`} aria-live="polite">
      {run.runtimeError ? <>
        <p className="eyebrow">ПОЛЁТ ОСТАНОВЛЕН</p>
        <h1>Не удалось продолжить</h1>
        <p role="alert" className="error-copy">{run.runtimeError}</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>Обновить страницу <span>↻</span></button>
      </> : <>
        {run.phase === 'READY' && <><p className="eyebrow">НЕБОЛЬШОЙ ПОЛЁТ</p><h1>Привет,<br />путешественник!</h1><p className="instruction">Нажми, чтобы взлететь.<br />Пролетай между трубами.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!run.rendererReady || busy}>Начать полёт <span>→</span></button><p className="keyboard-hint">или нажми <kbd>ПРОБЕЛ</kbd></p></>}
        {run.phase === 'PAUSED' && <><p className="eyebrow">ПЕРЕДЫШКА</p><h1>На паузе</h1><p className="instruction">Твой полёт ждёт.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!run.rendererReady || busy}>Продолжить <span>→</span></button></>}
        {run.phase === 'DEAD' && <><p className="eyebrow">ПОЛЁТ ЗАВЕРШЁН</p><h1>Хороший заход!</h1><p className="result-score">{run.score}<span> очков</span></p><p className="instruction">Лучший результат: {progress.best}</p><p className="earnings-summary"><span>За этот полёт</span><strong>✦ {progress.lastGain?.FEATHER ?? 0} перьев</strong><strong>★ {progress.lastGain?.GAME_STAR ?? 0} Game Star</strong></p><p className="wallet-disclaimer">Game Star — локальные игровые единицы, не Telegram XTR.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={restart} disabled={!run.rendererReady || busy || Boolean(run.runtimeError)}>Ещё раз <span>↻</span></button></>}
        {!run.rendererReady && !run.runtimeError && <p className="loading-copy">Готовим поляну…</p>}
      </>}
    </section>}
    {run.phase === 'RUNNING' && <p className="tap-hint" aria-hidden="true">КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ</p>}
  </main>;
}
