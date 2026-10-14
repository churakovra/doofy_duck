import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  createRun, createRunDescriptor, makeInput, pauseRun, restartRun, resumeRun, step,
  type GameEvent, type RunState,
} from '@doofy-duck/game-sim';
import { FixedStepClock } from './clock';
import { createInputController } from './input';
import { messages } from './messages.ru';

const MAX_QUEUED_INPUTS = 8;
type RunCallbacks = {
  onFlapUnlock(): void;
  onFlap(): void;
  onPickup(typeId: string): void;
  onPhaseChange(phase: RunState['phase']): void;
  onRunEnded(event: Extract<GameEvent, { type: 'RunEnded' }>): void;
};

function descriptor() {
  const seed = new Uint32Array(1);
  crypto.getRandomValues(seed);
  return createRunDescriptor({ runId: crypto.randomUUID(), seed: seed[0]! });
}

function freshRun() { return createRun(descriptor()); }

export function useGameRun(canPlay: () => boolean, callbacks: RunCallbacks) {
  const [initial] = useState(freshRun);
  const runRef = useRef(initial);
  const queuedRef = useRef<ReturnType<typeof makeInput>[]>([]);
  const sequenceRef = useRef(0);
  const [phase, setPhase] = useState(initial.phase);
  const [score, setScore] = useState(0);
  const [runtimeError, setRuntimeError] = useState('');
  const [rendererReady, setRendererReady] = useState(false);
  const rendererReadyRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  const canPlayRef = useRef(canPlay);
  const feedbackRef = useRef({ flapSerial: 0, pickupSerial: 0, deathSerial: 0 });
  const clockRef = useRef<FixedStepClock | null>(null);
  const resetClockOriginRef = useRef(true);

  callbacksRef.current = callbacks;
  canPlayRef.current = canPlay;

  const clearQueuedInputs = useCallback(() => {
    queuedRef.current = [];
    sequenceRef.current = runRef.current.nextInputSequence;
  }, []);

  const updateFromResult = useCallback((next: RunState, events: readonly GameEvent[]) => {
    const previous = runRef.current;
    runRef.current = next;
    if (next.phase !== previous.phase) {
      setPhase(next.phase);
      callbacksRef.current.onPhaseChange(next.phase);
    }
    if (next.score !== previous.score) setScore(next.score);
    for (const event of events) {
      if (event.type === 'CurrencyCollected') {
        feedbackRef.current.pickupSerial = (feedbackRef.current.pickupSerial + 1) % 1_000_000;
        callbacksRef.current.onPickup(event.typeId);
      } else if (event.type === 'RunEnded' && previous.phase !== 'DEAD') {
        feedbackRef.current.deathSerial = (feedbackRef.current.deathSerial + 1) % 1_000_000;
        callbacksRef.current.onRunEnded(event);
      }
    }
  }, []);

  const flap = useCallback(() => {
    const current = runRef.current;
    if (!canPlayRef.current() || !rendererReadyRef.current || current.phase === 'DEAD' || current.phase === 'PAUSED' || queuedRef.current.length >= MAX_QUEUED_INPUTS) return;
    if (current.phase === 'READY') {
      clockRef.current?.resume();
      resetClockOriginRef.current = true;
    }
    queuedRef.current.push(makeInput(sequenceRef.current, 'FLAP'));
    sequenceRef.current += 1;
    feedbackRef.current.flapSerial = (feedbackRef.current.flapSerial + 1) % 1_000_000;
    callbacksRef.current.onFlap();
  }, []);
  const inputRef = useRef(createInputController(flap));

  const acceptRenderer = useCallback((error?: string) => {
    if (error) {
      setRuntimeError(error);
      setRendererReady(false);
      rendererReadyRef.current = false;
      clearQueuedInputs();
      inputRef.current.reset();
      if (runRef.current.phase === 'RUNNING') updateFromResult(pauseRun(runRef.current), []);
    } else {
      setRuntimeError('');
      setRendererReady(true);
      rendererReadyRef.current = true;
    }
  }, [clearQueuedInputs, updateFromResult]);

  const getState = useCallback(() => runRef.current, []);
  const getFeedback = useCallback(() => ({ ...feedbackRef.current }), []);

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
        setRuntimeError(messages.simulationStoppedError);
        setRendererReady(false);
        rendererReadyRef.current = false;
        if (current.phase === 'RUNNING') updateFromResult(pauseRun(current), []);
        clearQueuedInputs();
        inputRef.current.reset();
      }
    });
    clockRef.current = clock;
    const onFrame = (time: number) => {
      const active = rendererReadyRef.current && (runRef.current.phase === 'RUNNING' || queuedRef.current.length > 0);
      if (!active) clock.resume();
      else if (last !== undefined) {
        // Waiting before start/resume is not active simulation time.
        const elapsed = resetClockOriginRef.current ? Math.min(time - last, 1000 / 60) : time - last;
        resetClockOriginRef.current = false;
        clock.advance(elapsed);
        if (clock.takePauseRequest()) {
          if (runRef.current.phase === 'RUNNING') updateFromResult(pauseRun(runRef.current), []);
          else clock.resume();
          clearQueuedInputs();
          inputRef.current.reset();
        }
      }
      last = time;
      frame = requestAnimationFrame(onFrame);
    };
    frame = requestAnimationFrame(onFrame);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') callbacksRef.current.onFlapUnlock();
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

  const start = useCallback(() => {
    if (!canPlay() || !rendererReadyRef.current || runtimeError) return;
    if (runRef.current.phase === 'PAUSED') {
      resetClockOriginRef.current = true;
      clockRef.current?.resume();
      updateFromResult(resumeRun(runRef.current), []);
      clearQueuedInputs();
      inputRef.current.reset();
    } else if (runRef.current.phase === 'READY') flap();
  }, [canPlay, clearQueuedInputs, flap, runtimeError, updateFromResult]);

  const pause = useCallback(() => {
    if (runRef.current.phase !== 'RUNNING') return;
    clockRef.current?.resume();
    updateFromResult(pauseRun(runRef.current), []);
    clearQueuedInputs();
    inputRef.current.reset();
  }, [clearQueuedInputs, updateFromResult]);

  const restart = useCallback(() => {
    if (!canPlay()) return;
    const next = restartRun(runRef.current, descriptor());
    runRef.current = next;
    clearQueuedInputs();
    setPhase(next.phase);
    setScore(0);
    callbacksRef.current.onPhaseChange(next.phase);
  }, [canPlay, clearQueuedInputs]);

  const onFieldPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    callbacksRef.current.onFlapUnlock();
    inputRef.current.onPointerDown({ button: event.button, targetIsButton: event.target instanceof Element && Boolean(event.target.closest('button')), preventDefault: () => event.preventDefault() });
  }, []);
  const onFieldPointerUp = useCallback(() => callbacksRef.current.onFlapUnlock(), []);
  const unlockForStart = useCallback(() => callbacksRef.current.onFlapUnlock(), []);

  return {
    phase, score, runtimeError, rendererReady,
    getState, getFeedback, acceptRenderer, flap, start, pause, restart,
    onFieldPointerDown, onFieldPointerUp, unlockForStart,
  };
}
