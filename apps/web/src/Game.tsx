import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRun, makeInput, pauseRun, restartRun, resumeRun, step } from '@doofy-duck/game-sim';
import type { GameEvent, RunDescriptor, RunState } from '@doofy-duck/game-sim';
import { FixedStepClock } from './clock';
import { createInputController } from './input';
import { readBest, writeBest } from './storage';
import { loadWallet, settleWalletRun, type WalletBalances } from './wallet';
import { acquireWalletSession, browserWalletLocks } from './wallet-session';
import { createGameAudio, loadAudioPreferences, saveAudioPreferences, type AudioPreferences } from './audio';
import { GameCanvas } from './GameCanvas';

function descriptor(): RunDescriptor {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return { runId: crypto.randomUUID(), seed: seed[0]!, simulationVersion: '1.1.0', generatorVersion: '1.0.0', configId: 'dd-v1-speed-v1' };
}

function freshRun(): RunState {
  return createRun(descriptor());
}

const MAX_QUEUED_INPUTS = 8;

export function Game() {
  const [initial] = useState(freshRun);
  const runRef = useRef(initial);
  const queuedRef = useRef<ReturnType<typeof makeInput>[]>([]);
  const sequenceRef = useRef(0);
  const [phase, setPhase] = useState(initial.phase);
  const [score, setScore] = useState(0);
  const [wallet, setWallet] = useState<WalletBalances>({ FEATHER: 0, GAME_STAR: 0 });
  const walletRef = useRef<WalletBalances>({ FEATHER: 0, GAME_STAR: 0 });
  const settledRunIdsRef = useRef<string[]>([]);
  const [walletPersistent, setWalletPersistent] = useState(false);
  const [walletSessionStatus, setWalletSessionStatus] = useState<'pending' | 'owned' | 'memory' | 'busy'>('pending');
  const walletSessionStatusRef = useRef(walletSessionStatus);
  const walletWritesEnabledRef = useRef(false);
  const [lastGain, setLastGain] = useState<WalletBalances | null>(null);
  const [audioPreferences, setAudioPreferences] = useState<AudioPreferences>(() => loadAudioPreferences());
  const audioRef = useRef<ReturnType<typeof createGameAudio> | null>(null);
  const feedbackRef = useRef({ flapSerial: 0, pickupSerial: 0, deathSerial: 0 });
  const [best, setBest] = useState(readBest);
  const [rendererError, setRendererError] = useState('');
  const [rendererReady, setRendererReady] = useState(false);
  const rendererReadyRef = useRef(false);
  const hudBest = best;

  const clearQueuedInputs = useCallback(() => {
    queuedRef.current = [];
    sequenceRef.current = runRef.current.nextInputSequence;
  }, []);

  const updateFromResult = useCallback((next: RunState, events: readonly GameEvent[]) => {
    const previous = runRef.current;
    runRef.current = next;
    if (next.phase !== previous.phase) setPhase(next.phase);
    if (next.score !== previous.score) setScore(next.score);
    for (const event of events) {
      if (event.type === 'CurrencyCollected') {
        feedbackRef.current.pickupSerial = (feedbackRef.current.pickupSerial + 1) % 1_000_000;
        audioRef.current?.pickup(event.typeId);
      }
      if (event.type === 'RunEnded' && previous.phase !== 'DEAD') {
        feedbackRef.current.deathSerial = (feedbackRef.current.deathSerial + 1) % 1_000_000;
        audioRef.current?.death();
        const settlement = settleWalletRun(walletRef.current, { runId: event.runId, totals: event.totals }, walletWritesEnabledRef.current ? undefined : null, settledRunIdsRef.current);
        walletRef.current = settlement.wallet;
        settledRunIdsRef.current = settlement.settledRunIds;
        walletWritesEnabledRef.current = walletWritesEnabledRef.current && settlement.persistent;
        setWallet(settlement.wallet);
        setLastGain(settlement.gain);
        setWalletPersistent(settlement.persistent);
        if (!settlement.persistent) {
          walletSessionStatusRef.current = 'memory';
          setWalletSessionStatus('memory');
        }
      }
    }
    if (next.phase !== previous.phase) audioRef.current?.setPhase(next.phase);
    if (next.phase === 'DEAD' && previous.phase !== 'DEAD') {
      const nextBest = Math.max(readBest(), next.score);
      let browserStore: Storage | undefined;
      try { browserStore = window.localStorage; } catch { browserStore = undefined; }
      writeBest(browserStore, nextBest);
      setBest(nextBest);
    }
    if (events.some((event) => event.type === 'RunStarted')) setPhase('RUNNING');
  }, []);

  const acceptRenderer = useCallback((error?: string) => {
    if (error) {
      setRendererError(error);
      setRendererReady(false);
      rendererReadyRef.current = false;
      clearQueuedInputs();
      inputRef.current.reset();
      if (runRef.current.phase === 'RUNNING') updateFromResult(pauseRun(runRef.current), []);
    } else { setRendererError(''); setRendererReady(true); rendererReadyRef.current = true; }
  }, [clearQueuedInputs, updateFromResult]);

  const flap = useCallback(() => {
    const current = runRef.current;
    if (walletSessionStatusRef.current === 'pending' || walletSessionStatusRef.current === 'busy' || !rendererReadyRef.current || current.phase === 'DEAD' || current.phase === 'PAUSED' || queuedRef.current.length >= MAX_QUEUED_INPUTS) return;
    queuedRef.current.push(makeInput(sequenceRef.current, 'FLAP'));
    sequenceRef.current += 1;
    feedbackRef.current.flapSerial = (feedbackRef.current.flapSerial + 1) % 1_000_000;
    audioRef.current?.flap();
  }, []);
  const inputRef = useRef(createInputController(flap));
  const clockRef = useRef<FixedStepClock | null>(null);

  const getState = useCallback(() => runRef.current, []);
  const getFeedback = useCallback(() => ({ ...feedbackRef.current }), []);

  useEffect(() => acquireWalletSession(browserWalletLocks(), {
    owned: () => {
      const loaded = loadWallet();
      walletRef.current = loaded.wallet;
      settledRunIdsRef.current = loaded.settledRunIds;
      walletWritesEnabledRef.current = loaded.persistent;
      setWallet(loaded.wallet);
      setWalletPersistent(loaded.persistent);
      walletSessionStatusRef.current = 'owned';
      setWalletSessionStatus('owned');
    },
    busy: () => {
      walletSessionStatusRef.current = 'busy';
      setWalletSessionStatus('busy');
    },
    memoryOnly: () => {
      walletWritesEnabledRef.current = false;
      setWalletPersistent(false);
      walletSessionStatusRef.current = 'memory';
      setWalletSessionStatus('memory');
    },
  }).dispose, []);

  useEffect(() => {
    const audio = createGameAudio(audioPreferences);
    audioRef.current = audio;
    audio.setPhase(runRef.current.phase);
    return () => {
      audio.dispose();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  useEffect(() => { audioRef.current?.setPhase(phase); }, [phase]);
  useEffect(() => {
    audioRef.current?.setPreferences(audioPreferences);
    saveAudioPreferences(audioPreferences);
  }, [audioPreferences]);

  const toggleAudioPreference = (key: keyof AudioPreferences) => {
    const next = { ...audioPreferences, [key]: !audioPreferences[key] };
    setAudioPreferences(next);
    audioRef.current?.unlockFromGesture();
  };

  useEffect(() => {
    let frame = 0;
    let last: number | undefined;
    const clock = new FixedStepClock(() => {
      if (!rendererReadyRef.current) return;
      const current = runRef.current;
      if (current.phase !== 'RUNNING' && queuedRef.current.length === 0) return;
      const batch = queuedRef.current.splice(0, 1);
      try {
        const result = step(current, batch);
        updateFromResult(result.state, result.events);
        if (result.state.phase === 'DEAD') {
          clearQueuedInputs();
          inputRef.current.reset();
        }
      } catch {
        setRendererError('Игровая симуляция остановлена из-за ошибки. Обновите страницу.');
        setRendererReady(false);
        rendererReadyRef.current = false;
        if (current.phase === 'RUNNING') updateFromResult(pauseRun(current), []);
        clearQueuedInputs();
        inputRef.current.reset();
      }
    });
    clockRef.current = clock;
    const onFrame = (time: number) => {
      if (last !== undefined) {
        clock.advance(time - last);
        if (clock.takePauseRequest() && runRef.current.phase === 'RUNNING') {
          updateFromResult(pauseRun(runRef.current), []);
          clearQueuedInputs();
          inputRef.current.reset();
        }
      }
      last = time;
      frame = requestAnimationFrame(onFrame);
    };
    frame = requestAnimationFrame(onFrame);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') audioRef.current?.unlockFromGesture();
      inputRef.current.onKeyDown({ code: event.code, repeat: event.repeat, targetIsButton: event.target instanceof Element && Boolean(event.target.closest('button')), preventDefault: () => event.preventDefault() });
    };
    const onKeyUp = (event: KeyboardEvent) => inputRef.current.onKeyUp(event.code);
    const onVisibility = () => {
      if (document.hidden && runRef.current.phase === 'RUNNING') {
        updateFromResult(pauseRun(runRef.current), []);
        clearQueuedInputs();
        inputRef.current.reset();
        clock.resume();
      }
      last = undefined;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
      clockRef.current = null;
      clearQueuedInputs();
      inputRef.current.reset();
    };
  }, [clearQueuedInputs, updateFromResult]);

  const start = (event: React.PointerEvent | React.MouseEvent) => {
    if (walletSessionStatusRef.current === 'pending' || walletSessionStatusRef.current === 'busy') return;
    event.preventDefault();
    event.stopPropagation();
    audioRef.current?.unlockFromGesture();
    if (!rendererReadyRef.current || rendererError) return;
    if (runRef.current.phase === 'PAUSED') {
      clockRef.current?.resume();
      updateFromResult(resumeRun(runRef.current), []);
      clearQueuedInputs();
      inputRef.current.reset();
      return;
    }
    if (runRef.current.phase === 'READY') flap();
  };

  const restart = (event: React.PointerEvent | React.MouseEvent) => {
    if (walletSessionStatusRef.current === 'pending' || walletSessionStatusRef.current === 'busy') return;
    event.preventDefault();
    event.stopPropagation();
    const next = restartRun(runRef.current, descriptor());
    runRef.current = next;
    clearQueuedInputs();
    setPhase(next.phase);
    setScore(0);
    setBest(readBest());
  };

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    audioRef.current?.unlockFromGesture();
    inputRef.current.onPointerDown({ button: event.button, targetIsButton: event.target instanceof Element && Boolean(event.target.closest('button')), preventDefault: () => event.preventDefault() });
  };
  const pointerUp = () => audioRef.current?.unlockFromGesture();
  const pause = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (runRef.current.phase === 'RUNNING') {
      clockRef.current?.resume();
      updateFromResult(pauseRun(runRef.current), []);
      clearQueuedInputs();
      inputRef.current.reset();
    }
  };

  return <main className="game-shell" onPointerDown={pointerDown} onPointerUp={pointerUp}>
    <div className="stage" aria-label="Игровое поле">
      <GameCanvas getState={getState} onReady={acceptRenderer} getFeedback={getFeedback} />
    </div>
    <header className="hud" aria-live="polite">
      <div className="brand"><span className="brand-mark">✦</span><span>DOOFY<br />DUCK</span></div>
      <div className="score-card"><span>СЧЁТ</span><strong>{score}</strong></div>
      <div className="best-card"><span>РЕКОРД</span><strong>{hudBest}</strong></div>
      <button className="pause-button" type="button" aria-label="Пауза" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => pause(event as unknown as React.PointerEvent<HTMLButtonElement>)} disabled={phase !== 'RUNNING' || Boolean(rendererError)}>Ⅱ</button>
    </header>
    <footer className="wallet-strip" aria-label="Локальный игровой кошелёк">
      <div className="wallet-total"><span className="token feather">✦</span><span>Перья · всего</span><strong>{wallet.FEATHER}</strong></div>
      <div className="wallet-total"><span className="token star">★</span><span>Game Star · всего</span><strong>{wallet.GAME_STAR}</strong></div>
      <p className={`wallet-storage ${walletPersistent ? '' : 'not-saved'}`}>{walletPersistent ? 'Кошелёк на этом устройстве' : walletSessionStatus === 'busy' ? 'Кошелёк занят в другой вкладке · закрой её и перезагрузи эту страницу' : walletSessionStatus === 'pending' ? 'Проверяем доступ к кошельку…' : 'Только в памяти · кошелёк не сохраняется на этом устройстве'}</p>
      <p className="wallet-local-note">Локальные игровые единицы · Game Star ≠ Telegram XTR</p>
    </footer>
    <nav className="audio-controls" aria-label="Настройки звука">
      <button type="button" aria-pressed={audioPreferences.sound} onPointerDown={(event) => event.stopPropagation()} onClick={() => toggleAudioPreference('sound')}>{audioPreferences.sound ? 'Звук: вкл.' : 'Звук: выкл.'}</button>
      <button type="button" aria-pressed={audioPreferences.music} onPointerDown={(event) => event.stopPropagation()} onClick={() => toggleAudioPreference('music')}>{audioPreferences.music ? 'Музыка: вкл.' : 'Музыка: выкл.'}</button>
    </nav>
    {phase !== 'RUNNING' && <section className={`screen-card ${phase.toLowerCase()}`} aria-live="polite">
      {phase === 'READY' && <><p className="eyebrow">НЕБОЛЬШОЙ ПОЛЁТ</p><h1>Привет,<br />путешественник!</h1><p className="instruction">Нажми, чтобы взлететь.<br />Пролетай между трубами.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!rendererReady || Boolean(rendererError) || walletSessionStatus === 'pending' || walletSessionStatus === 'busy'}>Начать полёт <span>→</span></button><p className="keyboard-hint">или нажми <kbd>ПРОБЕЛ</kbd></p></>}
      {phase === 'PAUSED' && <><p className="eyebrow">ПЕРЕДЫШКА</p><h1>На паузе</h1><p className="instruction">Твой полёт ждёт.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={start} disabled={!rendererReady || Boolean(rendererError) || walletSessionStatus === 'pending' || walletSessionStatus === 'busy'}>Продолжить <span>→</span></button></>}
      {phase === 'DEAD' && <><p className="eyebrow">ПОЛЁТ ЗАВЕРШЁН</p><h1>Хороший заход!</h1><p className="result-score">{score}<span> очков</span></p><p className="instruction">Лучший результат: {hudBest}</p><p className="earnings-summary"><span>За этот полёт</span><strong>✦ {lastGain?.FEATHER ?? 0} перьев</strong><strong>★ {lastGain?.GAME_STAR ?? 0} Game Star</strong></p><p className="wallet-disclaimer">Game Star — локальные игровые единицы, не Telegram XTR.</p><button type="button" className="primary-button" onPointerDown={(event) => event.stopPropagation()} onClick={restart} disabled={!rendererReady || Boolean(rendererError) || walletSessionStatus === 'pending' || walletSessionStatus === 'busy'}>Ещё раз <span>↻</span></button></>}
      {!rendererReady && !rendererError && <p className="loading-copy">Готовим поляну…</p>}
      {rendererError && <p role="alert" className="error-copy">{rendererError}</p>}
    </section>}
    {phase === 'RUNNING' && <p className="tap-hint" aria-hidden="true">КАСАЙСЯ, ЧТОБЫ ВЗЛЕТЕТЬ</p>}
  </main>;
}
