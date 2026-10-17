import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRun, createRunDescriptor, pauseRun, type RunState } from '@doofy-duck/game-sim';
import { AccountApi, AccountApiError, type AccountRunSnapshot, type AccountSummary } from './account-api';
import { acknowledgeCheckpoint, acknowledgeLatestTrace, appendTraceTick, checkpointPendingTicks, createAccountTraceStorage, type AccountTrace, type TraceStorage } from './account-trace';
import { GameButton } from './GameButton';
import { GameCanvas } from './GameCanvas';
import { GameSettings } from './GameSettings';
import { AccountShop } from './AccountShop';
import { accountEquipmentAppearance } from './account-shop-assets';
import { formatDecimalBalance } from './account-shop';
import { formatCountUnit, formatNumber, useLocale } from './locale';
import { useGameAudio } from './useGameAudio';
import { useGameRun } from './useGameRun';
import { DEFAULT_EQUIPMENT, type Equipment } from './wardrobe';
import { loadTelegramWebApp, TelegramWebAppUnavailableError } from './telegram-web-app';

type Screen = 'signed-out' | 'idle' | 'loading' | 'active' | 'recovering' | 'takeover' | 'locked';
type CompletionSettlement = { status: 'pending' | 'committed' | 'ineligible' | 'actionable_failure'; reason: string; credited: { FEATHER: string; GAME_STAR: string } };
const ACTIVE_TICK_LIMIT = 216_000;

function parseCompletionSettlement(value: unknown): CompletionSettlement {
  const result = value as Partial<CompletionSettlement> | null;
  if (!result || !['pending', 'committed', 'ineligible', 'actionable_failure'].includes(result.status ?? '')
    || !result.credited || !/^(0|[1-9]\d{0,39})$/.test(result.credited.FEATHER)
    || !/^(0|[1-9]\d{0,39})$/.test(result.credited.GAME_STAR)) throw new Error('completion_status_invalid');
  return result as CompletionSettlement;
}

async function telegramWebAppReady() {
  const webApp = await loadTelegramWebApp();
  webApp.ready?.();
  return webApp;
}

async function loginWithTelegram(api: AccountApi, isCurrent: () => boolean = () => true): Promise<AccountSummary | undefined> {
  const webApp = await telegramWebAppReady();
  if (!isCurrent()) return undefined;
  const initData = webApp.initData?.trim() ?? '';
  if (!initData) throw new AccountApiError(400, 'telegram_init_data_missing');
  return api.login(initData);
}

function accountErrorCopy(reason: unknown, messages: ReturnType<typeof useLocale>['messages']): string {
  if (reason instanceof TelegramWebAppUnavailableError) return messages.accountActionFailed;
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
  const [settlement, setSettlement] = useState<CompletionSettlement | 'loading' | 'unavailable' | null>(null);
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
  const [shopOpen, setShopOpen] = useState(false);
  const [equipment, setEquipment] = useState<Equipment>(DEFAULT_EQUIPMENT);
  const writeChainRef = useRef(Promise.resolve());
  const pumpRef = useRef(false);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const releaseLockRef = useRef<(() => void) | undefined>(undefined);
  const restorePromiseRef = useRef<Promise<AccountSummary> | null>(null);
  const telegramLoginPromiseRef = useRef<Promise<AccountSummary> | null>(null);
  const loadAccountRef = useRef<(user: AccountSummary) => Promise<void>>(() => Promise.resolve());
  const sessionEpochRef = useRef(0);
  const appearance = useMemo(() => accountEquipmentAppearance(equipment), [equipment]);


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
    setEquipment(DEFAULT_EQUIPMENT);
    if (accountRef.current && accountRef.current.account_id !== user.account_id) {
      setBestScore(null);
      releaseLockRef.current?.(); releaseLockRef.current = undefined;
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current);
    }
    accountRef.current = user;
    const epoch = sessionEpochRef.current;
    setAccount(user);
    try {
      const result = await api.shopEquipment();
      if (epoch === sessionEpochRef.current && accountRef.current?.account_id === user.account_id) {
        const rows = result.equipment;
        setEquipment({
          skinId: rows.find((row) => row.item_type === 'skin')?.item_id ?? DEFAULT_EQUIPMENT.skinId,
          backgroundId: rows.find((row) => row.item_type === 'background')?.item_id ?? DEFAULT_EQUIPMENT.backgroundId,
        });
      }
    } catch { /* Keep safe server defaults until the account wardrobe can be read. */ }
    if (epoch !== sessionEpochRef.current) return;
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
    let cancelled = false;
    const bootstrapEpoch = sessionEpochRef.current;
    const isCurrentBootstrap = () => !cancelled && bootstrapEpoch === sessionEpochRef.current;
    const telegramReady = telegramWebAppReady();
    void telegramReady.catch(() => undefined);
    restorePromiseRef.current ??= api.restore();
    void restorePromiseRef.current.then(async (user) => {
      if (isCurrentBootstrap()) await loadAccountRef.current(user);
    }).catch(() => {
      if (!isCurrentBootstrap()) return;
      void telegramReady.then((webApp) => {
        if (!isCurrentBootstrap()) return;
        const initData = webApp.initData?.trim() ?? '';
        if (!initData) {
          setError(messagesRef.current.accountAuthOutsideTelegram);
          setScreen('signed-out');
          return;
        }
        telegramLoginPromiseRef.current ??= api.login(initData);
        void telegramLoginPromiseRef.current.then((user) => {
          if (isCurrentBootstrap()) return loadAccountRef.current(user);
        }).catch((reason: unknown) => {
          if (isCurrentBootstrap()) { setError(accountErrorCopy(reason, messagesRef.current)); setScreen('signed-out'); }
        });
      }).catch((reason: unknown) => {
        if (isCurrentBootstrap()) { setError(accountErrorCopy(reason, messagesRef.current)); setScreen('signed-out'); }
      });
    });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => {
    const shouldPoll = snapshot?.status === 'completion_pending'
      || (snapshot?.verificationStatus === 'verified' && snapshot.deliveryStatus === 'pending');
    if (!account || !snapshot || !shouldPoll) return;
    const epoch = sessionEpochRef.current;
    const accountId = account.account_id;
    const runId = snapshot.runId;
    let cancelled = false;
    const isCurrentPoll = () => {
      const current = snapshotRef.current;
      return !cancelled
        && epoch === sessionEpochRef.current
        && accountRef.current?.account_id === accountId
        && current?.runId === runId
        && (current.status === 'completion_pending' || current.deliveryStatus === 'pending');
    };
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
  }, [account?.account_id, api, refreshAccountProgress, snapshot?.deliveryStatus, snapshot?.runId, snapshot?.status, storage]);

  useEffect(() => {
    if (!account || snapshot?.status !== 'completed' || snapshot.verificationStatus !== 'verified') {
      setSettlement(null);
      return;
    }
    const accountId = account.account_id;
    const runId = snapshot.runId;
    const lifeIndex = snapshot.lifeIndex;
    const epoch = sessionEpochRef.current;
    let current = true;
    setSettlement('loading');
    void api.completion(runId, lifeIndex).then((value) => {
      if (!current || epoch !== sessionEpochRef.current || accountRef.current?.account_id !== accountId || snapshotRef.current?.runId !== runId) return;
      setSettlement(parseCompletionSettlement(value));
    }).catch(() => {
      if (current && epoch === sessionEpochRef.current && accountRef.current?.account_id === accountId && snapshotRef.current?.runId === runId) setSettlement('unavailable');
    });
    return () => { current = false; };
  }, [account?.account_id, api, snapshot?.lifeIndex, snapshot?.runId, snapshot?.status, snapshot?.verificationStatus]);

  const login = async (dev: boolean) => {
    const epoch = ++sessionEpochRef.current;
    setBusy(true); setError('');
    try {
      const user = dev ? await api.loginDev(Number(devUserId)) : await loginWithTelegram(api, () => epoch === sessionEpochRef.current);
      if (epoch !== sessionEpochRef.current || !user) return;
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
    const epoch = ++sessionEpochRef.current;
    setBusy(true);
    setError('');
    try {
      let user: AccountSummary;
      if (import.meta.env.DEV) {
        try {
          const webApp = await telegramWebAppReady();
          if (epoch !== sessionEpochRef.current) return;
          user = webApp.initData?.trim() ? await api.login(webApp.initData) : await api.loginDev(Number(devUserId));
        } catch (reason) {
          if (!(reason instanceof TelegramWebAppUnavailableError)) throw reason;
          if (epoch !== sessionEpochRef.current) return;
          user = await api.loginDev(Number(devUserId));
        }
      } else {
        const telegramUser = await loginWithTelegram(api, () => epoch === sessionEpochRef.current);
        if (!telegramUser) return;
        user = telegramUser;
      }
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
    setEquipment(DEFAULT_EQUIPMENT);
    setAccount(null);
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
  if (activeSnapshot && account) return <AccountFlight
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
    shopOpen={shopOpen}
    setShopOpen={setShopOpen}
    equipment={equipment}
    setEquipment={setEquipment}
    appearance={appearance}
    api={api}
    accountId={account.account_id}
    sessionEpoch={sessionEpochRef.current}
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

  const statusMessage = snapshot?.verificationStatus === 'verified'
    ? snapshot.deliveryStatus === 'pending' ? messages.accountDeliveryPending
      : snapshot.deliveryStatus === 'rejected' ? messages.accountDeliveryRejected : messages.accountVerified
    : snapshot?.status === 'completion_pending' ? messages.accountPendingVerification
      : snapshot?.status === 'rejected' ? messages.accountGameplayRejected : '';
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
            <GameButton variant="control" className="account-mode-button" onClick={() => void login(false)} disabled={busy}>{messages.accountLogin}</GameButton>
          </>}
        </>}
        {screen === 'loading' && <p role="status">{messages.accountLoading}</p>}
        {screen === 'recovering' && <><p role="status">{error || notice || messages.accountConnectionRestoring}</p>{snapshot && account && <GameButton variant="control" onClick={() => void reconcile(snapshot, account)} disabled={busy}>{messages.accountStatusRetry}</GameButton>}{snapshot?.status === 'active' && trace && <GameButton variant="control" className="account-mode-button" onClick={() => void abandon()} disabled={busy}>{messages.accountAbandon}</GameButton>}</>}
      {screen === 'idle' && account && <>
          {bestScore !== null && <p className="account-best-score"><span>{messages.bestScoreLabel}</span> <strong>{formatNumber(locale, bestScore)}</strong></p>}
          {statusMessage && <p role="status">{statusMessage}</p>}
          {verifiedRun && <>
            <p className="result-score">{formatNumber(locale, verifiedRun.score)} <span>{formatCountUnit(locale, 'score', verifiedRun.score)}</span></p>
            <p className="earnings-summary"><span>{messages.accountVerifiedPickupsLabel}</span><strong>{formatNumber(locale, verifiedRun.totals.FEATHER ?? 0)} {messages.feathersShortLabel}</strong><strong>{formatNumber(locale, verifiedRun.totals.GAME_STAR ?? 0)} {messages.gameStarsShortLabel}</strong></p>
            <section className="account-settlement" aria-label={messages.accountSettlementStatus}>
              <strong>{messages.accountSettlementStatus}</strong>
              {settlement === 'loading' && <p role="status">{messages.accountLoading}</p>}
              {settlement === 'unavailable' && <p role="status">{messages.accountShopSettlementUnavailable}</p>}
              {settlement === null && <p>{messages.accountSettlementPending}</p>}
              {settlement && typeof settlement === 'object' && settlement.status === 'committed' && <><p>{messages.accountSettlementCommitted}</p><p>{formatDecimalBalance(settlement.credited.FEATHER, locale)} {messages.feathersShortLabel} · {formatDecimalBalance(settlement.credited.GAME_STAR, locale)} {messages.gameStarsShortLabel}</p></>}
              {settlement && typeof settlement === 'object' && settlement.status === 'pending' && <p>{messages.accountSettlementPending}</p>}
              {settlement && typeof settlement === 'object' && settlement.status === 'ineligible' && <p>{messages.accountSettlementIneligible}</p>}
              {settlement && typeof settlement === 'object' && settlement.status === 'actionable_failure' && <p>{messages.accountSettlementActionableFailure}</p>}
            </section>
            <p className="account-reward-note">{messages.accountRewardsNotSpendable}</p>
          </>}
          {(snapshot?.status === 'rejected' || snapshot?.status === 'completion_pending') && <GameButton variant="control" onClick={() => void checkStatus()} disabled={busy}>{messages.accountStatusRetry}</GameButton>}
          {!snapshot || snapshot.status === 'completed' || snapshot.status === 'rejected' || snapshot.status === 'abandoned' || snapshot.verificationStatus === 'verified' ? <GameButton variant="primary" onClick={() => void createRun()} disabled={busy}>{messages.accountStart}</GameButton> : null}
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
        {account && <AccountShop api={api} accountId={account.account_id} sessionEpoch={sessionEpochRef.current} locale={locale} messages={messages} portalContainer={frameRef} open={shopOpen} onOpenChange={setShopOpen} equipment={equipment} onEquipment={setEquipment} />}
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
  shopOpen: boolean; setShopOpen(open: boolean): void; equipment: Equipment; setEquipment(next: Equipment): void;
  appearance: ReturnType<typeof accountEquipmentAppearance>; storageWarning: boolean; api: AccountApi; accountId: string; sessionEpoch: number;
  notice: string; error: string; onTick(state: RunState, inputs: readonly { sequence: number; action: 'FLAP' }[]): void; onFinish(): void; onReauthenticate(): void; reauthRequired: boolean; onBack(): void; onAbandon(): void; busy: boolean; walletSlot: React.ReactNode;
};

function AccountFlight(props: FlightProps) {
  const { messages, locale, setLocale, audio, frameRef, snapshot } = props;
  const initial = snapshot.state.phase === 'RUNNING' ? pauseRun(snapshot.state) : snapshot.state;
  const callbacks = useMemo(() => ({
    onFlapUnlock: audio.unlockFromGesture, onFlap: audio.flap, onPickup: audio.pickup,
    onPhaseChange: audio.setPhase, onRunEnded: () => props.onFinish(),
  }), [audio, props.onFinish]);
  const run = useGameRun(() => !props.settingsOpen && !props.shopOpen, callbacks, {
    initialState: initial,
    activeTickLimit: snapshot.activeTickLimit || ACTIVE_TICK_LIMIT,
    onTick: props.onTick,
  });
  const [settingsOpen, setSettingsOpen] = [props.settingsOpen, props.setSettingsOpen];
  const totals = run.getState().totals;
  const feathers = totals.FEATHER ?? 0;
  const stars = totals.GAME_STAR ?? 0;
  const start = () => { audio.unlockFromGesture(); run.start(); };

  return <main className="game-shell" onPointerDown={run.onFieldPointerDown} onPointerUp={run.onFieldPointerUp}>
    <div className="game-viewport"><div className={`game-frame ${run.phase.toLowerCase()}`} ref={frameRef}>
      <div className="stage" aria-label={messages.gameFieldLabel}><GameCanvas getState={run.getState} onReady={run.acceptRenderer} getFeedback={run.getFeedback} appearance={props.appearance} /></div>
      <header className="hud account-hud">
        <div className="brand"><span className="brand-mark">{messages.brandMark}</span><span>{messages.brandNameFirstLine}<br />{messages.brandNameSecondLine}</span></div>
        <div className="score-group"><div className="score-card"><span>{messages.scoreLabel}</span><strong>{formatNumber(locale, run.score)}</strong></div>{props.bestScore !== null && <div className="score-card"><span>{messages.bestScoreLabel}</span><strong>{formatNumber(locale, props.bestScore)}</strong></div>}</div>
        {run.phase === 'RUNNING' && <output className="running-score">{formatNumber(locale, run.score)}</output>}
        {props.reauthRequired && <GameButton variant="control" onClick={props.onReauthenticate} disabled={props.busy}>{messages.accountLogin}</GameButton>}
        <div className="hud-actions">
          <GameSettings open={settingsOpen} onOpenChange={setSettingsOpen} locale={locale} setLocale={setLocale} messages={messages}
            preferences={audio.preferences} toggle={audio.toggle} wallet={{ FEATHER: 0, GAME_STAR: 0 }} walletPersistent walletStatus="" walletBlocked={false}
            portalContainer={frameRef} walletHeading={messages.accountHeading} walletSlot={props.walletSlot} />
          {run.phase !== 'RUNNING' && <AccountShop api={props.api} accountId={props.accountId} sessionEpoch={props.sessionEpoch} locale={locale} messages={messages} portalContainer={frameRef} open={props.shopOpen} onOpenChange={props.setShopOpen} equipment={props.equipment} onEquipment={props.setEquipment} />}
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
        </>}
      </div></section>}
    </div></div>
  </main>;
}
