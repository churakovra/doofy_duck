import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { GameButton } from './GameButton';
import { formatNumber, type Locale } from './locale';
import type { MessageCatalog } from './messages.ru';

type Props = {
  locale: Locale;
  setLocale(locale: Locale): void;
  messages: MessageCatalog;
  preferences: { sound: boolean; music: boolean };
  wallet: { FEATHER: number; GAME_STAR: number };
  walletPersistent: boolean;
  walletStatus: string;
  walletBlocked: boolean;
  toggle(kind: 'sound' | 'music'): void;
  portalContainer: RefObject<HTMLElement | null>;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  disabled?: boolean;
  walletSlot?: ReactNode;
  walletHeading?: string;
};

type LanguageDropdownProps = {
  locale: Locale;
  setLocale(locale: Locale): void;
  messages: MessageCatalog;
  dialogRef: RefObject<HTMLElement | null>;
};

function LanguageDropdown({ locale, setLocale, messages, dialogRef }: LanguageDropdownProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeLocale, setActiveLocale] = useState<Locale>(locale);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const labels: Record<Locale, string> = { ru: messages.russianLanguage, en: messages.englishLanguage };
  const options: Locale[] = ['ru', 'en'];

  useEffect(() => {
    if (!expanded) return;
    const activeOption = listboxRef.current?.querySelector<HTMLElement>(`[data-value="${activeLocale}"]`);
    activeOption?.focus();
  }, [expanded, activeLocale]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [expanded]);

  const closeList = (returnFocus = true) => {
    setExpanded(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const selectLocale = (value: Locale) => {
    setLocale(value);
    closeList();
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = options.indexOf(activeLocale);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeList();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((control) => !listboxRef.current?.contains(control));
      const triggerIndex = controls.indexOf(triggerRef.current!);
      const destination = controls[triggerIndex + (event.shiftKey ? -1 : 1)];
      closeList(false);
      (destination ?? triggerRef.current)?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveLocale(options[(index + direction + options.length) % options.length]!);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveLocale(event.key === 'Home' ? options[0]! : options[options.length - 1]!);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectLocale(activeLocale);
    }
  };

  return <div className="locale-controls">
    <span className="settings-label" id="game-language-label">{messages.languageSettingsLabel}</span>
    <div className="language-select" ref={rootRef} onPointerDown={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="language-select-trigger"
        data-testid="language-dropdown-trigger"
        data-dialog-initial-focus
        aria-label={`${messages.languageSettingsLabel}: ${labels[locale]}`}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls="game-language-listbox"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setActiveLocale(locale);
          setExpanded(true);
        }}
        onClick={() => {
          setActiveLocale(locale);
          setExpanded((previous) => !previous);
        }}
      >
        <span>{labels[locale]}</span>
        <span className="language-select-chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded && <div
        ref={listboxRef}
        id="game-language-listbox"
        className="language-select-listbox"
        role="listbox"
        aria-label={messages.languageSettingsLabel}
        onKeyDown={onListKeyDown}
      >
        {options.map((option) => <div
          id={`game-language-option-${option}`}
          key={option}
          className={`language-select-option${locale === option ? ' selected' : ''}${activeLocale === option ? ' active' : ''}`}
          role="option"
          aria-selected={locale === option}
          aria-label={labels[option]}
          data-value={option}
          tabIndex={-1}
          onClick={() => selectLocale(option)}
          onFocus={() => setActiveLocale(option)}
        >
          <span>{labels[option]}</span>
          {locale === option && <span className="language-select-check" aria-hidden="true">✓</span>}
        </div>)}
      </div>}
    </div>
  </div>;
}

export function GameSettings({ locale, setLocale, messages, preferences, toggle, wallet, walletPersistent, walletStatus, walletBlocked, portalContainer, open: controlledOpen, onOpenChange, disabled = false, walletSlot, walletHeading }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); };
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
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const controls = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

  const openMenu = () => setOpen(true);

  return <>
    <GameButton
      ref={triggerRef}
      variant="control"
      className="menu-trigger"
      aria-label={messages.menuLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
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
        <LanguageDropdown locale={locale} setLocale={setLocale} messages={messages} dialogRef={dialogRef} />
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
        <section className="settings-wallet" aria-labelledby="settings-wallet-heading">
          <h3 id="settings-wallet-heading">{walletHeading ?? messages.walletLabel}</h3>
          {walletSlot ?? <>
          <div className="settings-wallet-values">
            <p>{messages.feathersTotalLabel}<strong>{formatNumber(locale, wallet.FEATHER)}</strong></p>
            <p>{messages.gameStarsTotalLabel}<strong>{formatNumber(locale, wallet.GAME_STAR)}</strong></p>
          </div>
          <p className={`settings-wallet-status ${walletPersistent ? '' : 'not-saved'}`} role={walletBlocked ? 'status' : undefined}>{walletStatus}</p>
          <p className="settings-wallet-note">{messages.walletLocalUnitsNote}</p>
          </>}
        </section>
      </section>
    </div>, portalContainer.current)}
  </>;
}
