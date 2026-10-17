import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRun, createRunDescriptor, pauseRun, type RunState } from '@doofy-duck/game-sim';
import { AccountApi, AccountApiError, type AccountRunSnapshot, type AccountSummary } from './account-api';
import { acknowledgeCheckpoint, acknowledgeLatestTrace, appendTraceTick, checkpointPendingTicks, createAccountTraceStorage, type AccountTrace, type TraceStorage } from './account-trace';
import { GameButton } from './GameButton';
import { GameCanvas } from './GameCanvas';
import { GameSettings } from './GameSettings';
import { GameWardrobe } from './GameWardrobe';
import { formatCountUnit, formatNumber, useLocale } from './locale';
import { useGameAudio } from './useGameAudio';
import { useGameRun } from './useGameRun';
import { createWardrobeSession, readBrowserWardrobeStorage, resolveEquipmentAppearance, resolveEquipmentAssets, type Equipment } from './wardrobe';

type Screen = 'signed-out' | 'idle' | 'loading' | 'active' | 'recovering' | 'takeover' | 'locked';
const ACTIVE_TICK_LIMIT = 216_000;

function telegramInitData(): string {
  return (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? '';
}

function accountErrorCopy(reason: unknown, messages: ReturnType<typeof useLocale>['messages']): string {
  if (!(reason instanceof AccountApiError)) return messages.accountServiceUnavailable;
  if (reason.code === 'telegram_init_data_missing') return messages.accountAuthOutsideTelegram;
  if (reason.code === 'account_session_expired' || reason.code === 'account_session_required' || reason.status === 401) return messages.accountSessionExpired;
  if (reason.code === 'writer_fenced') return messages.accountNeedTakeover;
  if (reason.code === 'submission_expired') return messages.accountSubmissionExpired;
  if (reason.code === 'checkpoint_gap' || reason.code === 'idempotency_conflict') return messages.accountTraceConflict;
  if (reason.status >= 500 || reason.status === 0) return messages.accountServiceUnavailable;
  return messages.accountActionFailed;
}

export function AccountGame({ onBack }: { onBack(): void }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [api] = useState(() => new AccountApi());
  const [storage] = useState<TraceStorage>(() => createAccountTraceStorage());
  const { locale, messages, setLocale } = useLocale();
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const audio = useGameAudio();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const accountRef = useRef<AccountSummary | null>(null);
  const [screen, setScreen] = useState<Screen>('signed-out');
  const [snapshot, setSnapshot] = useState<AccountRunSnapshot | null>(null);
  const snapshotRef = useRef<AccountRunSnapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  const [trace, setTrace] = useState<AccountTrace | null>(null);
  const traceRef = useRef<AccountTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reauthRequired, setReauthRequired] = useState(false);
  const [devUserId, setDevUserId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [wardrobe] = useState(() => createWardrobeSession(readBrowserWardrobeStorage()));
  const [equipment, setEquipment] = useState<Equipment>(wardrobe.equipped);
  const [wardrobeWarning, setWardrobeWarning] = useState(wardrobe.warning);
  const writeChainRef = useRef(Promise.resolve());
  const pumpRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const releaseLockRef = useRef<(() => void) | undefined>(undefined);
  const restorePromiseRef = useRef<Promise<AccountSummary> | null>(null);
  const telegramLoginPromiseRef = useRef<Promise<AccountSummary> | null>(null);
  const loadAccountRef = useRef<(user: AccountSummary) => Promise<void>>(() => Promise.resolve());
  const sessionEpochRef = useRef(0);
  const appearance = useMemo(() => resolveEquipmentAppearance(equipment), [equipment]);
  const imageAssets = useMemo(() => resolveEquipmentAssets(equipment), [equipment]);

  useEffect(() => {
    (window as Window & { Telegram?: { WebApp?: { ready?: () => void } } }).Telegram?.WebApp?.ready?.();
  }, []);

  const claimWriter = useCallback(async (accountId: string, runId: string): Promise<boolean> => {
    releaseLockRef.current?.();
    releaseLockRef.current = undefined;
    if (typeof navigator === 'undefined' || !navigator.locks) return true;
    return new Promise((resolve) => {
      let settle!: () => void;
      const held = new Promise<void>((done) => { settle = done; });
      void navigator.locks.request(`doofy-duck:account-run:${accountId}:${runId}`, {
        mode: 'exclusive', ifAvailable: true,
      }, async (lock) => {
        if (!lock) { resolve(false); return; }
        releaseLockRef.current = settle;
        resolve(true);
        await held;
      }).catch(() => resolve(false));
    });
  }, []);

  useEffect(() => () => {
    sessionEpochRef.current += 1;
    accountRef.current = null;
    releaseLockRef.current?.();
    if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
  }, []);

  const refreshAccountProgress = useCallback(async (accountId: string, epoch: number) => {
    try {
      const progress = await api.progress();
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      setBestScore(progress.bestScore);
    } catch {
      // Keep the server score unknown until a later successful read.
    }
  }, [api]);

  const persistTrace = useCallback((next: AccountTrace, notify = true) => {
    traceRef.current = next;
    if (notify) setTrace(next);
    writeChainRef.current = writeChainRef.current.then(() => storage.save(next));
    return writeChainRef.current;
  }, [storage]);

  const installSnapshot = useCallback((next: AccountRunSnapshot, nextTrace: AccountTrace) => {
    setSnapshot(next);
    void persistTrace(nextTrace);
    setError('');
    setNotice('');
    setScreen('active');
  }, [persistTrace]);

  const pumpCheckpoints = useCallback(async () => {
    if (pumpRef.current || !traceRef.current) return;
    pumpRef.current = true;
    const epoch = sessionEpochRef.current;
    let submittedTrace: AccountTrace | undefined;
    try {
      await writeChainRef.current;
      while (traceRef.current?.pending.length) {
        const current = traceRef.current;
        submittedTrace = current;
        const checkpoint = current.pending[0]!;
        setNotice(messages.accountConnectionReady);
        const response = await api.submitCheckpoint(current.runId, {
          checkpointSequence: checkpoint.sequence,
          writerGeneration: current.writerGeneration,
          writerToken: current.writerToken,
          idempotencyKey: checkpoint.idempotencyKey,
          ticks: checkpoint.ticks,
        });
        if (epoch !== sessionEpochRef.current) return;
        const latest = traceRef.current;
        if (!latest || latest.runId !== current.runId || latest.writerGeneration !== current.writerGeneration) return;
        const next = acknowledgeLatestTrace(latest, current, response.checkpointSequence, response.activeTicks);
        if (next === latest && (latest.runId !== current.runId || latest.writerGeneration !== current.writerGeneration)) return;
        await persistTrace(next, true);
        setSnapshot(response);
        if (response.verificationStatus === 'verified') void refreshAccountProgress(current.accountId, epoch);
        if (response.status !== 'active') {
          setScreen('idle');
          if (next.unsentTicks.length === 0 && next.pending.length === 0) {
            await storage.remove(next.accountId, next.runId, next.writerGeneration);
            traceRef.current = null; setTrace(null);
          }
          break;
        }
        retryRef.current = 0;
        setNotice('');
      }
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      const apiError = reason instanceof AccountApiError
        ? reason
        : reason && typeof reason === 'object' && 'status' in reason && 'code' in reason
          && typeof reason.status === 'number' && typeof reason.code === 'string'
          ? reason as AccountApiError
          : undefined;
      if (apiError?.code === 'writer_fenced') {
        setScreen('takeover');
        setError(messages.accountNeedTakeover);
      } else if (apiError?.code === 'submission_expired' || apiError?.code === 'idempotency_conflict' || apiError?.code === 'checkpoint_gap') {
        if (!submittedTrace || traceRef.current?.runId !== submittedTrace.runId) return;
        const failureCopy = apiError.code === 'submission_expired' ? messages.accountSubmissionExpired : messages.accountTraceConflict;
        try {
          const latest = await api.getRun(submittedTrace.runId);
          if (epoch !== sessionEpochRef.current) return;
          setSnapshot(latest);
          setNotice('');
          if (latest.status === 'rejected' || latest.status === 'completed' || latest.status === 'abandoned') {
            await storage.remove(submittedTrace.accountId, submittedTrace.runId, submittedTrace.writerGeneration);
            if (epoch !== sessionEpochRef.current) return;
            traceRef.current = null; setTrace(null); setScreen('idle'); setError('');
          } else {
            setScreen('recovering');
            setError(failureCopy);
          }
        } catch {
          setError(failureCopy);
          setNotice('');
        }
      } else if (apiError?.status === 401) {
        setReauthRequired(true);
        setError(messages.accountSessionExpired);
        setNotice('');
      } else if (apiError?.code === 'auth_refresh_coordination_unavailable') {
        setReauthRequired(true);
        setError(messages.accountSessionExpired);
        setNotice('');
      } else if (apiError?.code === 'auth_refresh_outcome_uncertain') {
        setReauthRequired(true);
        setError(messages.accountSessionExpired);
        setNotice('');
      } else if (apiError && apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429) {
        setError(accountErrorCopy(apiError, messages));
        setNotice('');
      } else {
        setError('');
        setNotice(messages.accountServiceUnavailable);
        const delay = Math.max(apiError?.retryAfterMs ?? 0, Math.min(30_000, 1_000 * 2 ** Math.min(retryRef.current, 5))) + Math.floor(Math.random() * 500);
        retryRef.current += 1;
        if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => { void pumpCheckpoints(); }, delay);
      }
    } finally {
      pumpRef.current = false;
    }
  }, [api, messages, persistTrace, refreshAccountProgress, storage]);

  const recordTick = useCallback((state: RunState, inputs: readonly { sequence: number; action: 'FLAP' }[]) => {
    const current = traceRef.current;
    if (!current) return;
    let next = appendTraceTick(current, inputs);
    const terminalTick = state.phase === 'DEAD' || state.tick >= ACTIVE_TICK_LIMIT;
    if (terminalTick) next = checkpointPendingTicks(next);
    const shouldNotify = next.pending.length > current.pending.length;
    void persistTrace(next, shouldNotify).then(() => {
      if (shouldNotify || terminalTick) void pumpCheckpoints();
    });
    if (state.tick >= ACTIVE_TICK_LIMIT) setNotice(messages.accountFlightCap);
  }, [messages.accountFlightCap, persistTrace, pumpCheckpoints]);

  const finishTrace = useCallback(() => {
    const current = traceRef.current;
    if (!current) return;
    const next = checkpointPendingTicks(current);
    if (next !== current) void persistTrace(next).then(() => pumpCheckpoints());
    else void pumpCheckpoints();
  }, [persistTrace, pumpCheckpoints]);

  const reconcile = useCallback(async (next: AccountRunSnapshot, user: AccountSummary, writerClaimed = false, epoch = sessionEpochRef.current) => {
    if (epoch !== sessionEpochRef.current) return;
    setScreen('loading');
    setSnapshot(next);
    if (next.status !== 'active') {
      setTrace(null);
      traceRef.current = null;
      setScreen('idle');
      return;
    }
    if (!writerClaimed && !await claimWriter(user.account_id, next.runId)) {
      if (epoch !== sessionEpochRef.current) return;
      setScreen('locked');
      setError(messages.accountWriterBusy);
      return;
    }
    let saved = await storage.load(user.account_id, next.runId);
    if (epoch !== sessionEpochRef.current) return;
    if (!saved || saved.writerGeneration !== next.writerGeneration || !saved.writerToken) {
      setTrace(saved ?? null);
      traceRef.current = saved ?? null;
      setScreen('takeover');
      setError(messages.accountNeedTakeover);
      return;
    }
    if (!writerClaimed && (typeof navigator === 'undefined' || !navigator.locks)) {
      setTrace(saved);
      traceRef.current = saved;
      setScreen('takeover');
      setError(messages.accountNeedTakeover);
      return;
    }
    saved = acknowledgeCheckpoint(saved, next.checkpointSequence, next.activeTicks);
    const retainedTicks = saved.unsentTicks.length + saved.pending.reduce((sum, checkpoint) => sum + checkpoint.ticks.length, 0);
    if (saved.activeTicks !== next.activeTicks + retainedTicks) {
      setTrace(saved);
      traceRef.current = saved;
      setScreen('takeover');
      setError(messages.accountTraceConflict);
      return;
    }
    saved = checkpointPendingTicks(saved);
    await storage.save(saved);
    if (epoch !== sessionEpochRef.current) return;
    let latest = next;
    traceRef.current = saved; setTrace(saved);
    try {
      for (const checkpoint of saved.pending) {
        if (checkpoint.sequence <= latest.checkpointSequence) continue;
        latest = await api.submitCheckpoint(saved.runId, {
          checkpointSequence: checkpoint.sequence,
          writerGeneration: saved.writerGeneration,
          writerToken: saved.writerToken,
          idempotencyKey: checkpoint.idempotencyKey,
          ticks: checkpoint.ticks,
        });
        if (epoch !== sessionEpochRef.current) return;
        saved = acknowledgeCheckpoint(saved, latest.checkpointSequence, latest.activeTicks);
        traceRef.current = saved; setTrace(saved);
        await storage.save(saved);
      }
      latest = await api.getRun(latest.runId);
      if (epoch !== sessionEpochRef.current) return;
    } catch {
      if (epoch !== sessionEpochRef.current) return;
      setSnapshot(latest);
      setScreen('recovering');
      setNotice(messages.accountConnectionRestoring);
      return;
    }
    saved = acknowledgeCheckpoint(saved, latest.checkpointSequence, latest.activeTicks);
    traceRef.current = saved;
    setTrace(saved);
    setSnapshot(latest);
    if (latest.status === 'active') setScreen('active');
    else setScreen('idle');
  }, [api, claimWriter, messages.accountConnectionRestoring, messages.accountNeedTakeover, messages.accountWriterBusy, storage]);

  const loadAccountState = useCallback(async (user: AccountSummary) => {
    if (accountRef.current && accountRef.current.account_id !== user.account_id) {
      sessionEpochRef.current += 1;
      setBestScore(null);
      releaseLockRef.current?.(); releaseLockRef.current = undefined;
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
    }
    accountRef.current = user;
    const epoch = sessionEpochRef.current;
    setAccount(user);
    void refreshAccountProgress(user.account_id, epoch);
    setScreen('loading');
    await writeChainRef.current;
    if (epoch !== sessionEpochRef.current) return;
    const current = await api.currentRun();
    if (epoch !== sessionEpochRef.current) return;
    if (current) {
      await reconcile(current, user, false, epoch);
      return;
    }
    const latest = await api.latestRun();
    if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== user.account_id) return;
    setTrace(null);
    traceRef.current = null;
    if (latest?.accountId === user.account_id && (latest.status === 'active' || latest.status === 'completion_pending')) {
      await reconcile(latest, user, false, epoch);
      return;
    }
    setSnapshot(latest?.accountId === user.account_id && latest.verificationStatus === 'verified' ? latest : null);
    setScreen('idle');
  }, [api, reconcile, refreshAccountProgress]);

  loadAccountRef.current = loadAccountState;

  useEffect(() => {
    restorePromiseRef.current ??= api.restore();
    let cancelled = false;
    void restorePromiseRef.current.then(async (user) => {
      if (!cancelled) await loadAccountRef.current(user);
    }).catch(() => {
      const initData = telegramInitData();
      if (cancelled) return;
      if (!initData) { setScreen('signed-out'); return; }
      telegramLoginPromiseRef.current ??= api.login(initData);
      void telegramLoginPromiseRef.current.then((user) => {
        if (!cancelled) return loadAccountRef.current(user);
      }).catch((reason: unknown) => {
        if (!cancelled) { setError(accountErrorCopy(reason, messagesRef.current)); setScreen('signed-out'); }
      });
    });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    if (!account || snapshot?.status !== 'completion_pending') return;
    const epoch = sessionEpochRef.current;
    const accountId = account.account_id;
    const runId = snapshot.runId;
    let cancelled = false;
    const isCurrentPoll = () => !cancelled
      && epoch === sessionEpochRef.current
      && accountRef.current?.account_id === accountId
      && snapshotRef.current?.runId === runId
      && snapshotRef.current.status === 'completion_pending';
    const timer = window.setInterval(() => {
      void api.getRun(runId).then(async (latest) => {
        if (!isCurrentPoll()) return;
        setSnapshot(latest);
        if (latest.verificationStatus === 'verified') void refreshAccountProgress(accountId, epoch);
        if (latest.status === 'completed' || latest.status === 'rejected' || latest.status === 'abandoned') {
          setError(''); setNotice('');
          const current = traceRef.current;
          if (current && current.accountId === accountId && current.runId === runId) {
            await storage.remove(accountId, runId, current.writerGeneration);
            if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId
              || snapshotRef.current?.runId !== runId || traceRef.current !== current) return;
            traceRef.current = null; setTrace(null);
          }
        }
      }).catch(() => undefined);
    }, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [account?.account_id, api, refreshAccountProgress, snapshot?.runId, snapshot?.status, storage]);

  const login = async (dev: boolean) => {
    const epoch = sessionEpochRef.current;
    setBusy(true); setError('');
    try {
      const user = dev
        ? await api.loginDev(Number(devUserId))
        : await api.login(telegramInitData());
      if (epoch !== sessionEpochRef.current) return;
      await loadAccountState(user);
      if (epoch !== sessionEpochRef.current) return;
      setReauthRequired(false);
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      setError(accountErrorCopy(reason, messages));
      setScreen('signed-out');
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const reauthenticate = async () => {
    const epoch = sessionEpochRef.current;
    setBusy(true);
    setError('');
    try {
      const user = telegramInitData()
        ? await api.login(telegramInitData())
        : await api.loginDev(Number(devUserId));
      if (epoch !== sessionEpochRef.current) return;
      await loadAccountState(user);
      if (epoch !== sessionEpochRef.current) return;
      setReauthRequired(false);
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      setError(accountErrorCopy(reason, messages));
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const createRun = async () => {
    if (!account) return;
    const epoch = sessionEpochRef.current;
    setBusy(true); setError('');
    try {
      const created = await api.createRun();
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== account.account_id) return;
      if (created.status !== 'active' || !created.writerToken) {
        await reconcile(created, account, false, epoch);
        return;
      }
      if (!await claimWriter(account.account_id, created.runId)) {
        if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== account.account_id) return;
        setSnapshot(created); setScreen('locked'); setError(messages.accountWriterBusy); return;
      }
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== account.account_id) {
        releaseLockRef.current?.(); releaseLockRef.current = undefined;
        return;
      }
      const fresh: AccountTrace = {
        accountId: account.account_id, runId: created.runId, writerGeneration: created.writerGeneration,
        writerToken: created.writerToken, nextCheckpointSequence: created.checkpointSequence + 1,
        activeTicks: created.activeTicks, unsentTicks: [], pending: [],
      };
      await storage.save(fresh);
      if (epoch !== sessionEpochRef.current) return;
      installSnapshot(created, fresh);
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      if (reason instanceof AccountApiError && reason.status === 409) {
        try {
          const current = await api.currentRun();
          if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== account.account_id) return;
          if (current) { await reconcile(current, account, false, epoch); return; }
        } catch { /* Show the original conflict if recovery status cannot be loaded. */ }
      }
      setError(accountErrorCopy(reason, messages));
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const takeover = async () => {
    if (!account || !snapshot) return;
    if (!window.confirm(`${messages.accountTakeoverWarning}\n\n${messages.accountTakeoverHeading}`)) return;
    const epoch = sessionEpochRef.current;
    const accountId = account.account_id;
    const runId = snapshot.runId;
    setBusy(true); setError('');
    try {
      await writeChainRef.current;
      if (epoch !== sessionEpochRef.current) return;
      const beforeTakeover = await storage.load(accountId, runId);
      if (epoch !== sessionEpochRef.current) return;
      const next = await api.takeover(runId);
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      if (!next.writerToken) throw new AccountApiError(502, 'writer_token_missing');
      const afterTakeover = await storage.load(accountId, runId);
      if (epoch !== sessionEpochRef.current) return;
      // The second read is closest to the takeover and includes writes another
      // tab may have committed while the server rotated credentials.
      const previous = afterTakeover ?? beforeTakeover;
      let recovered: AccountTrace | undefined;
      if (previous && previous.accountId === accountId && previous.runId === runId) {
        const acknowledged = acknowledgeCheckpoint(previous, next.checkpointSequence, next.activeTicks);
        const retainedTicks = acknowledged.unsentTicks.length + acknowledged.pending.reduce((sum, checkpoint) => sum + checkpoint.ticks.length, 0);
        if (acknowledged.activeTicks === next.activeTicks + retainedTicks) {
          recovered = {
            ...acknowledged,
            writerGeneration: next.writerGeneration,
            writerToken: next.writerToken,
            nextCheckpointSequence: Math.max(acknowledged.nextCheckpointSequence, next.checkpointSequence + 1),
          };
        }
      }
      const nextTrace = recovered ?? {
        accountId, runId: next.runId, writerGeneration: next.writerGeneration,
        writerToken: next.writerToken, nextCheckpointSequence: next.checkpointSequence + 1,
        activeTicks: next.activeTicks, unsentTicks: [], pending: [],
      } satisfies AccountTrace;
      await storage.save(nextTrace);
      if (epoch !== sessionEpochRef.current) return;
      await reconcile(next, account, true, epoch);
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      setError(accountErrorCopy(reason, messages));
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const abandon = async () => {
    const current = traceRef.current;
    if (!current || !snapshot || !window.confirm(`${messages.accountAbandonWarning}\n\n${messages.accountConfirmAbandon}`)) return;
    const epoch = sessionEpochRef.current;
    const accountId = current.accountId;
    const runId = current.runId;
    setBusy(true);
    try {
      const next = await api.abandon(current.runId, current.writerGeneration, current.writerToken);
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      await storage.remove(current.accountId, current.runId, current.writerGeneration);
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      if (traceRef.current?.accountId !== accountId || traceRef.current.runId !== runId) return;
      traceRef.current = null; setTrace(null); setSnapshot(next); setScreen('idle');
    } catch (reason) {
      if (epoch !== sessionEpochRef.current) return;
      setError(accountErrorCopy(reason, messages));
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const checkStatus = async () => {
    if (!snapshot) return;
    const epoch = sessionEpochRef.current;
    const accountId = account?.account_id;
    const runId = snapshot.runId;
    setBusy(true);
    try {
      const latest = await api.getRun(runId);
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      if (latest.verificationStatus === 'verified' && accountId) void refreshAccountProgress(accountId, epoch);
      setSnapshot(latest);
      if (latest.status !== 'active') {
        setScreen('idle');
        const current = traceRef.current;
        if (current && current.accountId === accountId && current.runId === runId) {
          await storage.remove(accountId!, runId, current.writerGeneration);
          if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
          traceRef.current = null; setTrace(null);
        }
      }
      setError('');
      setNotice('');
    } catch (reason) {
      if (epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId) return;
      setError(accountErrorCopy(reason, messages));
    } finally { if (epoch === sessionEpochRef.current) setBusy(false); }
  };

  const logout = async () => {
    sessionEpochRef.current += 1;
    accountRef.current = null;
    if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = undefined;
    pumpRef.current = false;
    await writeChainRef.current;
    if (account) await storage.clearAccount(account.account_id);
    releaseLockRef.current?.(); releaseLockRef.current = undefined;
    await api.logout();
    traceRef.current = null; setTrace(null); setSnapshot(null); setBestScore(null); setAccount(null); setScreen('signed-out');
  };

  const settingsWallet = <div><p>{messages.accountDescription}</p><p>{messages.accountRewardsNotSpendable}</p></div>;
  const activeSnapshot = snapshot?.status === 'active' && screen === 'active' && trace ? snapshot : null;
  if (activeSnapshot) return <AccountFlight
    key={activeSnapshot.runId}
    snapshot={activeSnapshot}
    bestScore={bestScore}
    messages={messages}
    locale={locale}
    setLocale={setLocale}
    audio={audio}
    frameRef={frameRef}
    settingsOpen={settingsOpen}
    setSettingsOpen={setSettingsOpen}
    wardrobeOpen={wardrobeOpen}
    setWardrobeOpen={setWardrobeOpen}
    equipment={equipment}
    setEquipment={(next) => { wardrobe.apply(next); setEquipment(wardrobe.equipped); setWardrobeWarning(wardrobe.warning); }}
    wardrobeWarning={wardrobeWarning}
    appearance={appearance}
    imageAssets={imageAssets}
    storageWarning={!storage.persistent}
    notice={notice}
    error={error}
    onTick={recordTick}
    onFinish={finishTrace}
    onReauthenticate={reauthenticate}
    reauthRequired={reauthRequired}
    onBack={onBack}
    onAbandon={abandon}
    busy={busy}
    walletSlot={settingsWallet}
  />;

  const statusMessage = snapshot?.status === 'completion_pending' ? messages.accountPendingVerification
    : snapshot?.status === 'completed' ? messages.accountVerified
      : snapshot?.status === 'rejected'
        ? snapshot.verificationStatus === 'verified' ? messages.accountDeliveryRejected : messages.accountGameplayRejected
        : '';
  const verifiedRun = snapshot && snapshot.verificationStatus === 'verified' ? snapshot.state : null;

  return <main className="game-shell" onPointerDown={() => undefined}>
    <div className="game-viewport"><div className="game-frame ready" ref={frameRef}>
      <div className="stage" aria-label={messages.gameFieldLabel}><GameCanvas getState={() => snapshot?.state ?? EMPTY_STATE} onReady={() => undefined} /></div>
      <header className="hud account-hud">
        <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
        <div className="account-toolbar">
          <select aria-label={messages.languageSettingsLabel} value={locale} onChange={(event) => setLocale(event.target.value as 'ru' | 'en')}><option value="ru">Русский</option><option value="en">English</option></select>
          <GameButton variant="control" aria-pressed={audio.preferences.sound} onClick={() => audio.toggle('sound')}>{messages.soundLabel}</GameButton>
          <GameButton variant="control" aria-pressed={audio.preferences.music} onClick={() => audio.toggle('music')}>{messages.musicLabel}</GameButton>
        </div>
      </header>
      <section className="screen-card" aria-live="polite"><div className="screen-panel account-panel">
        <p className="eyebrow">{messages.accountHeading}</p>
        <h1>{messages.accountHeading}</h1>
        <p className="instruction">{messages.accountDescription}</p>
        {screen === 'signed-out' && <>
          {!import.meta.env.DEV && <GameButton variant="primary" onClick={() => void login(false)} disabled={busy}>{messages.accountLogin}</GameButton>}
          {import.meta.env.DEV && <>
            <label className="account-dev-label">{messages.accountUserIdLabel}<input inputMode="numeric" value={devUserId} onChange={(event) => setDevUserId(event.target.value)} /></label>
            <GameButton variant="primary" onClick={() => void login(true)} disabled={busy || !devUserId}>{messages.accountDevLogin}</GameButton>
            <GameButton variant="control" className="account-mode-button" onClick={() => void login(false)} disabled={busy || !telegramInitData()}>{messages.accountLogin}</GameButton>
          </>}
        </>}
        {screen === 'loading' && <p role="status">{messages.accountLoading}</p>}
        {screen === 'recovering' && <><p role="status">{error || notice || messages.accountConnectionRestoring}</p>{snapshot && account && <GameButton variant="control" onClick={() => void reconcile(snapshot, account)} disabled={busy}>{messages.accountStatusRetry}</GameButton>}{snapshot?.status === 'active' && trace && <GameButton variant="control" className="account-mode-button" onClick={() => void abandon()} disabled={busy}>{messages.accountAbandon}</GameButton>}</>}
      {screen === 'idle' && account && <>
          {bestScore !== null && <p className="account-best-score"><span>{messages.bestScoreLabel}</span> <strong>{formatNumber(locale, bestScore)}</strong></p>}
          {statusMessage && <p role="status">{statusMessage}</p>}
          {verifiedRun && <>
            <p className="result-score">{formatNumber(locale, verifiedRun.score)} <span>{formatCountUnit(locale, 'score', verifiedRun.score)}</span></p>
            <p className="earnings-summary"><span>{messages.accountRewardsLabel}</span><strong>{formatNumber(locale, verifiedRun.totals.FEATHER ?? 0)} {messages.feathersShortLabel}</strong><strong>{formatNumber(locale, verifiedRun.totals.GAME_STAR ?? 0)} {messages.gameStarsShortLabel}</strong></p>
            <p className="account-reward-note">{messages.accountRewardsNotSpendable}</p>
          </>}
          {(snapshot?.status === 'rejected' || snapshot?.status === 'completion_pending') && <GameButton variant="control" onClick={() => void checkStatus()} disabled={busy}>{messages.accountStatusRetry}</GameButton>}
          {!snapshot || snapshot.status === 'completed' || snapshot.status === 'rejected' || snapshot.status === 'abandoned' ? <GameButton variant="primary" onClick={() => void createRun()} disabled={busy}>{messages.accountStart}</GameButton> : null}
          <p className="account-id">{account.telegram_user_id}</p>
        </>}
        {screen === 'takeover' && <>
          <p className="wallet-access-error" role="alert">{error || messages.accountNeedTakeover}</p>
          <GameButton variant="primary" onClick={() => void takeover()} disabled={busy}>{messages.accountTakeover}</GameButton>
        </>}
        {screen === 'locked' && <p role="alert">{error || messages.accountWriterBusy}</p>}
        {error && screen !== 'takeover' && <p className="wallet-access-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {storage.persistent === false && <p className="wallet-access-error" role="status">{messages.accountStorageWarning}</p>}
        {account && <GameButton variant="control" className="account-mode-button" onClick={() => void logout()} disabled={busy}>{messages.accountLogout}</GameButton>}
        <GameButton variant="control" className="account-mode-button" onClick={onBack}>{messages.accountModeBack}</GameButton>
      </div></section>
      <footer className="wallet-status-strip"><p className="wallet-storage">{messages.accountRewardsNotSpendable}</p></footer>
    </div></div>
  </main>;
}

const EMPTY_STATE = createRun(createRunDescriptor({ runId: '00000000-0000-4000-8000-000000000001', seed: 0 }));

type FlightProps = {
  snapshot: AccountRunSnapshot; bestScore: number | null; messages: ReturnType<typeof useLocale>['messages']; locale: 'ru' | 'en'; setLocale(locale: 'ru' | 'en'): void;
  audio: ReturnType<typeof useGameAudio>; frameRef: React.RefObject<HTMLDivElement | null>; settingsOpen: boolean; setSettingsOpen(open: boolean): void;
  wardrobeOpen: boolean; setWardrobeOpen(open: boolean): void; equipment: Equipment; setEquipment(next: Equipment): void; wardrobeWarning: boolean;
  appearance: ReturnType<typeof resolveEquipmentAppearance>; imageAssets: ReturnType<typeof resolveEquipmentAssets>; storageWarning: boolean;
  notice: string; error: string; onTick(state: RunState, inputs: readonly { sequence: number; action: 'FLAP' }[]): void; onFinish(): void; onReauthenticate(): void; reauthRequired: boolean; onBack(): void; onAbandon(): void; busy: boolean; walletSlot: React.ReactNode;
};

function AccountFlight(props: FlightProps) {
  const { messages, locale, setLocale, audio, frameRef, snapshot } = props;
  const initial = snapshot.state.phase === 'RUNNING' ? pauseRun(snapshot.state) : snapshot.state;
  const callbacks = useMemo(() => ({
    onFlapUnlock: audio.unlockFromGesture, onFlap: audio.flap, onPickup: audio.pickup,
    onPhaseChange: audio.setPhase, onRunEnded: () => props.onFinish(),
  }), [audio, props.onFinish]);
  const run = useGameRun(() => !props.settingsOpen && !props.wardrobeOpen, callbacks, {
    initialState: initial,
    activeTickLimit: snapshot.activeTickLimit || ACTIVE_TICK_LIMIT,
    onTick: props.onTick,
  });
  const [settingsOpen, setSettingsOpen] = [props.settingsOpen, props.setSettingsOpen];
  const [wardrobeOpen, setWardrobeOpen] = [props.wardrobeOpen, props.setWardrobeOpen];
  const totals = run.getState().totals;
  const feathers = totals.FEATHER ?? 0;
  const stars = totals.GAME_STAR ?? 0;
  const start = () => { audio.unlockFromGesture(); run.start(); };

  return <main className="game-shell" onPointerDown={run.onFieldPointerDown} onPointerUp={run.onFieldPointerUp}>
    <div className="game-viewport"><div className={`game-frame ${run.phase.toLowerCase()}`} ref={frameRef}>
      <div className="stage" aria-label={messages.gameFieldLabel}><GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} appearance={props.appearance} imageAssets={props.imageAssets} /></div>
      <header className="hud account-hud">
        <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
        <div className="score-group"><div className="score-card"><span>{messages.scoreLabel}</span><strong>{formatNumber(locale, run.score)}</strong></div>{props.bestScore !== null && <div className="score-card"><span>{messages.bestScoreLabel}</span><strong>{formatNumber(locale, props.bestScore)}</strong></div>}</div>
        {run.phase === 'RUNNING' && <output className="running-score">{formatNumber(locale, run.score)}</output>}
        {props.reauthRequired && <GameButton variant="control" onClick={props.onReauthenticate} disabled={props.busy}>{messages.accountLogin}</GameButton>}
        <div className="hud-actions">
          <GameSettings open={settingsOpen} onOpenChange={setSettingsOpen} locale={locale} setLocale={setLocale} messages={messages}
            preferences={audio.preferences} toggle={audio.toggle} wallet={{ FEATHER: 0, GAME_STAR: 0 }} walletPersistent walletStatus="" walletBlocked={false}
            portalContainer={frameRef} walletHeading={messages.accountHeading} walletSlot={props.walletSlot} />
          {run.phase !== 'RUNNING' && <GameButton variant="control" className="wardrobe-trigger" onClick={() => setWardrobeOpen(true)}>{messages.wardrobeLabel}</GameButton>}
          <GameButton variant="control" className="account-mode-button" onClick={props.onBack}>{messages.accountModeBack}</GameButton>
        </div>
      </header>
      <footer className="wallet-status-strip"><p className="wallet-storage">{props.error || props.notice || (props.storageWarning ? messages.accountStorageWarning : messages.accountRewardsLabel)}</p>{props.reauthRequired && <GameButton variant="control" onClick={props.onReauthenticate} disabled={props.busy}>{messages.accountLogin}</GameButton>}</footer>
      {run.phase !== 'RUNNING' && <section className="screen-card" aria-live="polite"><div className="screen-panel account-panel">
        {run.runtimeError ? <><p role="alert" className="error-copy">{messages[run.runtimeError]}</p><GameButton variant="primary" onClick={() => window.location.reload()}>{messages.reloadPageButton}</GameButton></> : <>
          {run.phase === 'READY' && <><p className="eyebrow">{messages.accountHeading}</p><h1>{messages.accountHeading}</h1><p className="instruction">{messages.accountDescription}</p><GameButton variant="primary" onClick={start} disabled={!run.rendererReady || props.busy}>{messages.startFlightButton} <span>{messages.forwardGlyph}</span></GameButton></>}
          {run.phase === 'PAUSED' && <><p className="eyebrow">{messages.pauseEyebrow}</p><h1>{run.flightCapReached ? messages.accountPendingVerification : messages.pausedHeading}</h1><GameButton variant="primary" onClick={run.flightCapReached ? props.onFinish : start} disabled={!run.rendererReady || props.busy}>{run.flightCapReached ? messages.accountStatusRetry : messages.accountResume}</GameButton><GameButton variant="control" className="account-mode-button" onClick={props.onAbandon} disabled={props.busy}>{messages.accountAbandon}</GameButton></>}
          {run.phase === 'DEAD' && <><p className="eyebrow">{messages.completedFlightEyebrow}</p><h1>{messages.completedHeading}</h1><p className="result-score">{formatNumber(locale, run.score)} <span>{formatCountUnit(locale, 'score', run.score)}</span></p><p className="earnings-summary"><span>{messages.accountRewardsLabel}</span><strong>{formatNumber(locale, feathers)} {messages.feathersShortLabel}</strong><strong>{formatNumber(locale, stars)} {messages.gameStarsShortLabel}</strong></p><p className="wallet-disclaimer">{messages.accountRewardsNotSpendable}</p><GameButton variant="primary" onClick={props.onFinish} disabled={props.busy}>{messages.accountStatusRetry}</GameButton></>}
          {props.error && <p className="wallet-access-error" role="alert">{props.error}</p>}
          {props.reauthRequired && <GameButton variant="control" onClick={props.onReauthenticate} disabled={props.busy}>{messages.accountLogin}</GameButton>}
          {props.notice && <p role="status">{props.notice}</p>}
          {props.storageWarning && <p className="wallet-access-error" role="status">{messages.accountStorageWarning}</p>}
          {props.wardrobeWarning && <p className="wardrobe-warning" role="status">{messages.wardrobeStorageWarning}</p>}
        </>}
      </div></section>}
      {wardrobeOpen && <GameWardrobe locale={locale} messages={messages} equipped={props.equipment} warning={props.wardrobeWarning} open onOpenChange={setWardrobeOpen} portalContainer={frameRef} onApply={props.setEquipment} onDismiss={() => setWardrobeOpen(false)} />}
    </div></div>
  </main>;
}
