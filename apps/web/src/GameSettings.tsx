import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { GameButton } from './GameButton';
import type { Locale } from './locale';
import type { MessageCatalog } from './messages.ru';

type Props = {
  locale: Locale;
  setLocale(locale: Locale): void;
  messages: MessageCatalog;
  preferences: { sound: boolean; music: boolean };
  toggle(kind: 'sound' | 'music'): void;
  isRunning: boolean;
  pause(): void;
  portalContainer: RefObject<HTMLElement | null>;
};

export function GameSettings({ locale, setLocale, messages, preferences, toggle, isRunning, pause, portalContainer }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const initialControl = dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    (initialControl ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )];
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const openMenu = () => {
    if (isRunning) pause();
    setOpen(true);
  };

  return <>
    <GameButton
      ref={triggerRef}
      variant="control"
      className="menu-trigger"
      aria-label={messages.menuLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => open ? close() : openMenu()}
    >
      <span aria-hidden="true">☰</span>
    </GameButton>
    {open && portalContainer.current && createPortal(<div className="settings-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-settings-heading"
        tabIndex={-1}
      >
        <div className="settings-dialog-header">
          <h2 id="game-settings-heading">{messages.settingsHeading}</h2>
          <GameButton variant="control" className="settings-close" aria-label={messages.closeSettingsLabel} onClick={close}>×</GameButton>
        </div>
        <div className="locale-controls">
          <label className="settings-label" htmlFor="game-language">{messages.languageSettingsLabel}</label>
          <select
            id="game-language"
            className="settings-language"
            aria-label={messages.languageSettingsLabel}
            data-dialog-initial-focus
            value={locale}
            onChange={(event) => setLocale(event.currentTarget.value as Locale)}
          >
            <option value="ru">{messages.russianLanguage}</option>
            <option value="en">{messages.englishLanguage}</option>
          </select>
        </div>
        <div className="audio-controls settings-audio" role="group" aria-label={messages.soundSettingsLabel}>
          <GameButton
            variant="control"
            aria-label={preferences.sound ? messages.soundEnabled : messages.soundDisabled}
            aria-pressed={preferences.sound}
            onClick={() => toggle('sound')}
          >{messages.soundLabel}</GameButton>
          <GameButton
            variant="control"
            aria-label={preferences.music ? messages.musicEnabled : messages.musicDisabled}
            aria-pressed={preferences.music}
            onClick={() => toggle('music')}
          >{messages.musicLabel}</GameButton>
        </div>
      </section>
    </div>, portalContainer.current)}
  </>;
}
