import { GameCanvas } from './GameCanvas';
import { messages } from './messages.ru';
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
    <div className="stage" aria-label={messages.gameFieldLabel}>
      <GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} />
    </div>
    <header className="hud" aria-live="polite">
      <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
      <div className="score-card"><span>{messages.scoreLabel}</span><strong>{run.score}</strong></div>
      <div className="best-card"><span>{messages.bestScoreLabel}</span><strong>{progress.best}</strong></div>
      <button className="pause-button" type="button" aria-label={messages.pauseButtonLabel} onPointerDown={(event) => event.stopPropagation()} onClick={run.pause} disabled={run.phase !== 'RUNNING' || Boolean(run.runtimeError)}>{messages.pauseGlyph}</button>
    </header>
    <footer className="wallet-strip" aria-label={messages.walletLabel}>
      <div className="wallet-total"><span className="token feather">{messages.brandMark}</span><span>{messages.feathersTotalLabel}</span><strong>{progress.wallet.FEATHER}</strong></div>
      <div className="wallet-total"><span className="token star">{messages.gameStarMark}</span><span>{messages.gameStarsTotalLabel}</span><strong>{progress.wallet.GAME_STAR}</strong></div>
      <p className={`wallet-storage ${progress.walletPersistent ? '' : 'not-saved'}`}>{progress.walletPersistent ? messages.walletOnDevice : progress.walletSessionStatus === 'busy' ? messages.walletBusy : progress.walletSessionStatus === 'pending' ? messages.walletChecking : messages.walletMemoryOnly}</p>
      <p className="wallet-local-note">{messages.walletLocalUnitsNote}</p>
    </footer>
    <nav className="audio-controls" aria-label={messages.soundSettingsLabel}>
      <button type="button" aria-pressed={audio.preferences.sound} onPointerDown={(event) => event.stopPropagation()} onClick={() => audio.toggle('sound')}>{audio.preferences.sound ? messages.soundEnabled : messages.soundDisabled}</button>
      <button type="button" aria-pressed={audio.preferences.music} onPointerDown={(event) => event.stopPropagation()} onClick={() => audio.toggle('music')}>{audio.preferences.music ? messages.musicEnabled : messages.musicDisabled}</button>
    </nav>
    {run.phase !== 'RUNNING' && <section className={`screen-card ${run.phase.toLowerCase()}`} aria-live="polite">
      {run.runtimeError ? <>
        <p className="eyebrow">{messages.flightStoppedEyebrow}</p>
        <h1>{messages.unableToContinueHeading}</h1>
        <p role="alert" className="error-copy">{run.runtimeError}</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>{messages.reloadPageButton} <span>{messages.reloadGlyph}</span></button>
      </> : <>
        {run.phase === 'READY' && <><p className="eyebrow">{messages.smallFlightEyebrow}</p><h1>{messages.greeting}<br />{messages.traveler}</h1><p className="instruction">{messages.readyInstructionFirstLine}<br />{messages.readyInstructionSecondLine}</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!run.rendererReady || busy}>{messages.startFlightButton} <span>{messages.forwardGlyph}</span></button><p className="keyboard-hint">{messages.keyboardHint} <kbd>{messages.spaceKey}</kbd></p></>}
        {run.phase === 'PAUSED' && <><p className="eyebrow">{messages.pauseEyebrow}</p><h1>{messages.pausedHeading}</h1><p className="instruction">{messages.pausedInstruction}</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!run.rendererReady || busy}>{messages.continueButton} <span>{messages.forwardGlyph}</span></button></>}
        {run.phase === 'DEAD' && <><p className="eyebrow">{messages.completedFlightEyebrow}</p><h1>{messages.completedHeading}</h1><p className="result-score">{run.score}<span>{messages.scoreSuffix}</span></p><p className="instruction">{messages.bestScorePrefix}{progress.best}</p><p className="earnings-summary"><span>{messages.earningsSummaryLabel}</span><strong>{messages.featherEarnedPrefix}{progress.lastGain?.FEATHER ?? 0}{messages.featherEarnedSuffix}</strong><strong>{messages.gameStarsEarnedPrefix}{progress.lastGain?.GAME_STAR ?? 0}{messages.gameStarsEarnedSuffix}</strong></p><p className="wallet-disclaimer">{messages.walletDisclaimer}</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={restart} disabled={!run.rendererReady || busy || Boolean(run.runtimeError)}>{messages.playAgainButton} <span>{messages.reloadGlyph}</span></button></>}
        {!run.rendererReady && !run.runtimeError && <p className="loading-copy">{messages.loadingScene}</p>}
      </>}
    </section>}
    {run.phase === 'RUNNING' && <p className="tap-hint" aria-hidden="true">{messages.runningTapHint}</p>}
  </main>;
}
