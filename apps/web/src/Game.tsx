import { useRef } from 'react';
import { GameButton } from './GameButton';
import { GameCanvas } from './GameCanvas';
import { GameSettings } from './GameSettings';
import { formatCount, formatCountUnit, formatNumber, useLocale } from './locale';
import { useGameAudio } from './useGameAudio';
import { useGameProgress } from './useGameProgress';
import { useGameRun } from './useGameRun';

export function Game() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { locale, messages, setLocale } = useLocale();
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
    <div className="game-viewport" ref={viewportRef}>
      <div className="stage" aria-label={messages.gameFieldLabel}>
        <GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} />
      </div>
      <header className="hud" aria-live="polite">
        <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
        <div className="score-card"><span>{messages.scoreLabel}</span><strong>{formatNumber(locale, run.score)}</strong></div>
        <div className="best-card"><span>{messages.bestScoreLabel}</span><strong>{formatNumber(locale, progress.best)}</strong></div>
        <GameSettings
          locale={locale}
          setLocale={setLocale}
          messages={messages}
          preferences={audio.preferences}
          toggle={audio.toggle}
          isRunning={run.phase === 'RUNNING'}
          pause={run.pause}
          portalContainer={viewportRef}
        />
      </header>
      <footer className="wallet-strip" aria-label={messages.walletLabel}>
        <div className="wallet-total" aria-label={formatCount(locale, 'coin', progress.wallet.FEATHER)}><span className="token feather">{messages.brandMark}</span><span>{messages.feathersTotalLabel}</span><strong>{formatNumber(locale, progress.wallet.FEATHER)}</strong></div>
        <div className="wallet-total" aria-label={formatCount(locale, 'gameStar', progress.wallet.GAME_STAR)}><span className="token star">{messages.gameStarMark}</span><span>{messages.gameStarsTotalLabel}</span><strong>{formatNumber(locale, progress.wallet.GAME_STAR)}</strong></div>
        <p className={`wallet-storage ${progress.walletPersistent ? '' : 'not-saved'}`}>{progress.walletPersistent ? messages.walletOnDevice : progress.walletSessionStatus === 'busy' ? messages.walletBusy : progress.walletSessionStatus === 'pending' ? messages.walletChecking : messages.walletMemoryOnly}</p>
        <p className="wallet-local-note">{messages.walletLocalUnitsNote}</p>
      </footer>
      {run.phase !== 'RUNNING' && <section className={`screen-card ${run.phase.toLowerCase()}`} aria-live="polite">
        {run.runtimeError ? <>
          <p className="eyebrow">{messages.flightStoppedEyebrow}</p>
          <h1>{messages.unableToContinueHeading}</h1>
          <p role="alert" className="error-copy">{messages[run.runtimeError]}</p>
          <GameButton variant="primary" onClick={() => window.location.reload()}>{messages.reloadPageButton} <span>{messages.reloadGlyph}</span></GameButton>
        </> : <>
          {run.phase === 'READY' && <><p className="eyebrow">{messages.smallFlightEyebrow}</p><h1>{messages.greeting}<br />{messages.traveler}</h1><p className="instruction">{messages.readyInstructionFirstLine}<br />{messages.readyInstructionSecondLine}</p><GameButton variant="primary" onClick={start} disabled={!run.rendererReady || busy}>{messages.startFlightButton} <span>{messages.forwardGlyph}</span></GameButton><p className="keyboard-hint">{messages.keyboardHint} <kbd>{messages.spaceKey}</kbd></p></>}
          {run.phase === 'PAUSED' && <><p className="eyebrow">{messages.pauseEyebrow}</p><h1>{messages.pausedHeading}</h1><p className="instruction">{messages.pausedInstruction}</p><GameButton variant="primary" onClick={start} disabled={!run.rendererReady || busy}>{messages.continueButton} <span>{messages.forwardGlyph}</span></GameButton></>}
          {run.phase === 'DEAD' && <><p className="eyebrow">{messages.completedFlightEyebrow}</p><h1>{messages.completedHeading}</h1><p className="result-score">{formatNumber(locale, run.score)} <span>{formatCountUnit(locale, 'score', run.score)}</span></p><p className="instruction">{messages.bestScorePrefix}{formatCount(locale, 'score', progress.best)}</p><p className="earnings-summary"><span>{messages.earningsSummaryLabel}</span><strong>{formatCount(locale, 'coin', progress.lastGain?.FEATHER ?? 0)}</strong><strong>{formatCount(locale, 'gameStar', progress.lastGain?.GAME_STAR ?? 0)}</strong></p><p className="wallet-disclaimer">{messages.walletDisclaimer}</p><GameButton variant="primary" onClick={restart} disabled={!run.rendererReady || busy || Boolean(run.runtimeError)}>{messages.playAgainButton} <span>{messages.reloadGlyph}</span></GameButton></>}
          {!run.rendererReady && !run.runtimeError && <p className="loading-copy">{messages.loadingScene}</p>}
        </>}
      </section>}
      {run.phase === 'RUNNING' && <p className="tap-hint" aria-hidden="true">{messages.runningTapHint}</p>}
    </div>
  </main>;
}
