import { useCallback, useMemo, useRef, useState } from 'react';
import { GameButton } from './GameButton';
import { GameCanvas } from './GameCanvas';
import { GameSettings } from './GameSettings';
import { GameWardrobe } from './GameWardrobe';
import { formatCount, formatCountUnit, formatNumber, useLocale } from './locale';
import { useGameAudio } from './useGameAudio';
import { useGameProgress } from './useGameProgress';
import { useGameRun } from './useGameRun';
import { createWardrobeSession, readBrowserWardrobeStorage, resolveEquipmentAppearance, resolveEquipmentAssets, type Equipment } from './wardrobe';

export function Game() {
  const frameRef = useRef<HTMLDivElement>(null);
  const { locale, messages, setLocale } = useLocale();
  const [wardrobe] = useState(() => createWardrobeSession(readBrowserWardrobeStorage()));
  const [equipment, setEquipment] = useState<Equipment>(wardrobe.equipped);
  const [wardrobeWarning, setWardrobeWarning] = useState(wardrobe.warning);
  const [activeModal, setActiveModal] = useState<'settings' | 'wardrobe' | null>(null);
  const appearance = useMemo(() => resolveEquipmentAppearance(equipment), [equipment]);
  const imageAssets = useMemo(() => resolveEquipmentAssets(equipment), [equipment]);
  const progress = useGameProgress();
  const audio = useGameAudio();
  const canPlay = useCallback(() => progress.canPlay() && activeModal === null, [activeModal, progress.canPlay]);
  const run = useGameRun(canPlay, {
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
  const walletStatus = progress.walletSessionStatus === 'pending'
    ? messages.walletChecking
    : progress.walletSessionStatus === 'busy'
      ? messages.walletBusy
      : progress.walletPersistent ? messages.walletOnDevice : messages.walletMemoryOnly;

  return <main className="game-shell" onPointerDown={run.onFieldPointerDown} onPointerUp={run.onFieldPointerUp}>
    <div className="game-viewport">
      <div className={`game-frame ${run.phase.toLowerCase()}`} ref={frameRef}>
      <div className="stage" aria-label={messages.gameFieldLabel}>
        <GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} appearance={appearance} imageAssets={imageAssets} />
      </div>
      <header className="hud" aria-live="polite">
        <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
        <div className="wallet-strip" aria-label={messages.walletLabel}>
          <div className="wallet-total" aria-label={formatCount(locale, 'coin', progress.wallet.FEATHER)}><span className="token feather" aria-hidden="true">{messages.brandMark}</span><strong>{formatNumber(locale, progress.wallet.FEATHER)}</strong></div>
          <div className="wallet-total" aria-label={formatCount(locale, 'gameStar', progress.wallet.GAME_STAR)}><span className="token star" aria-hidden="true">{messages.gameStarMark}</span><strong>{formatNumber(locale, progress.wallet.GAME_STAR)}</strong></div>
        </div>
        <div className="score-group" aria-label={`${messages.scoreLabel} / ${messages.bestScoreLabel}`}>
          <div className="score-card"><span>{messages.scoreLabel}</span><strong>{formatNumber(locale, run.score)}</strong></div>
          <div className="best-card"><span>{messages.bestScoreLabel}</span><strong>{formatNumber(locale, progress.best)}</strong></div>
        </div>
        {run.phase === 'RUNNING' && <output className="running-score" aria-label={`${messages.scoreLabel}: ${formatNumber(locale, run.score)}`}>
          {formatNumber(locale, run.score)}
        </output>}
        <div className="hud-actions">
        <GameSettings
          open={activeModal === 'settings'}
          onOpenChange={(open) => setActiveModal(open ? 'settings' : null)}
          disabled={activeModal === 'wardrobe'}
          locale={locale}
          setLocale={setLocale}
          messages={messages}
          preferences={audio.preferences}
          toggle={audio.toggle}
          wallet={progress.wallet}
          walletPersistent={progress.walletPersistent}
          walletStatus={walletStatus}
          walletBlocked={busy}
          portalContainer={frameRef}
        />
        {run.phase !== 'RUNNING' && <GameWardrobe
          locale={locale}
          messages={messages}
          equipped={equipment}
          warning={wardrobeWarning}
          open={activeModal === 'wardrobe'}
          onOpenChange={(open) => setActiveModal(open ? 'wardrobe' : null)}
          portalContainer={frameRef}
          onApply={(next) => {
            wardrobe.apply(next);
            setEquipment(wardrobe.equipped);
            setWardrobeWarning(wardrobe.warning);
          }}
          onDismiss={() => setActiveModal((current) => current === 'wardrobe' ? null : current)}
        />}
        </div>
      </header>
      <footer className="wallet-status-strip">
        <p className={`wallet-storage ${progress.walletPersistent ? '' : 'not-saved'}`}>{walletStatus}</p>
      </footer>
      {run.phase !== 'RUNNING' && <section className={`screen-card ${run.phase.toLowerCase()}`} aria-live="polite">
        <div className="screen-panel">
        {run.runtimeError ? <>
          <p className="eyebrow">{messages.flightStoppedEyebrow}</p>
          <h1>{messages.unableToContinueHeading}</h1>
          <p role="alert" className="error-copy">{messages[run.runtimeError]}</p>
          <GameButton variant="primary" onClick={() => window.location.reload()}>{messages.reloadPageButton} <span>{messages.reloadGlyph}</span></GameButton>
        </> : <>
          {run.phase === 'READY' && <><p className="eyebrow">{messages.smallFlightEyebrow}</p><h1>{messages.greeting}<br />{' '}{messages.traveler}</h1><p className="instruction">{messages.readyInstructionFirstLine}<br />{messages.readyInstructionSecondLine}</p><GameButton variant="primary" onClick={start} disabled={!run.rendererReady || busy}>{messages.startFlightButton} <span>{messages.forwardGlyph}</span></GameButton>{busy && <p className="wallet-access-error" role="status">{walletStatus}</p>}<p className="keyboard-hint">{messages.keyboardHint} <kbd>{messages.spaceKey}</kbd></p></>}
          {run.phase === 'PAUSED' && <><p className="eyebrow">{messages.pauseEyebrow}</p><h1>{messages.pausedHeading}</h1><p className="instruction">{messages.pausedInstruction}</p><GameButton variant="primary" onClick={start} disabled={!run.rendererReady || busy}>{messages.continueButton} <span>{messages.forwardGlyph}</span></GameButton></>}
          {run.phase === 'DEAD' && <><p className="eyebrow">{messages.completedFlightEyebrow}</p><h1>{messages.completedHeading}</h1><p className="result-score">{formatNumber(locale, run.score)} <span>{formatCountUnit(locale, 'score', run.score)}</span></p><p className="instruction">{messages.bestScorePrefix}{formatCount(locale, 'score', progress.best)}</p><p className="earnings-summary"><span>{messages.earningsSummaryLabel}</span><strong>{formatCount(locale, 'coin', progress.lastGain?.FEATHER ?? 0)}</strong><strong>{formatCount(locale, 'gameStar', progress.lastGain?.GAME_STAR ?? 0)}</strong></p><p className="wallet-disclaimer">{messages.walletDisclaimer}</p><GameButton variant="primary" onClick={restart} disabled={!run.rendererReady || busy || Boolean(run.runtimeError)}>{messages.playAgainButton} <span>{messages.reloadGlyph}</span></GameButton></>}
          {!run.rendererReady && !run.runtimeError && <p className="loading-copy">{messages.loadingScene}</p>}
          {wardrobeWarning && <p className="wardrobe-warning" role="status">{messages.wardrobeStorageWarning}</p>}
        </>}
        </div>
      </section>}
      </div>
    </div>
  </main>;
}
