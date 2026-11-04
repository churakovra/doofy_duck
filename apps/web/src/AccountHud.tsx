import type { ReactNode } from 'react';
import { formatNumber, type Locale } from './locale';

type Props = {
  bestScore: number | null;
  locale: Locale;
  recordLabel: string;
  wallet: ReactNode;
  actions: ReactNode;
  status?: ReactNode;
  runningScore?: number | undefined;
};

/** Shared HUD structure for the account lobby and an active flight. */
export function AccountHud({ bestScore, locale, recordLabel, wallet, actions, status, runningScore }: Props) {
  const record = bestScore === null ? '—' : formatNumber(locale, bestScore);
  // Fit the record between the wallet and actions, without truncating long values.
  const recordFontSize = Math.max(10, Math.min(40, 75 / record.length));

  return <header className="hud account-hud">
    {wallet}
    <div className="score-group record-group"><div className="score-card"><span>{recordLabel}</span><strong style={{ fontSize: recordFontSize }}>{record}</strong></div></div>
    {runningScore !== undefined && <output className="running-score">{formatNumber(locale, runningScore)}</output>}
    {status}
    <div className="hud-actions">{actions}</div>
  </header>;
}
