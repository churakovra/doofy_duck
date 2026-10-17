import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { GameButton } from './GameButton';
import { GameWardrobePreview } from './GameWardrobePreview';
import type { Locale } from './locale';
import type { MessageCatalog } from './messages.ru';
import { BACKGROUND_CATALOG, resolveEquipmentAppearance, resolveEquipmentAssets, SKIN_CATALOG, type Equipment } from './wardrobe';

type Props = {
  locale: Locale;
  messages: MessageCatalog;
  equipped: Equipment;
  warning: boolean;
  portalContainer: RefObject<HTMLElement | null>;
  onApply(equipment: Equipment): void;
  onDismiss(): void;
  open?: boolean;
  onOpenChange?(open: boolean): void;
};

const color = (value: number) => `#${value.toString(16).padStart(6, '0')}`;

export function GameWardrobe({ locale, messages, equipped, warning, portalContainer, onApply, onDismiss, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { setInternalOpen(next); onOpenChange?.(next); };
  const [draft, setDraft] = useState<Equipment>(equipped);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openDialog = () => { setDraft(equipped); setOpen(true); };
  const close = () => { setOpen(false); onDismiss(); triggerRef.current?.focus(); };
  const apply = () => { onApply(draft); setOpen(false); onDismiss(); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'Tab' && dialog) {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        const firstControl = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === firstControl || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); firstControl?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  return <>
    <GameButton ref={triggerRef} variant="control" className="wardrobe-trigger" aria-label={messages.wardrobeLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? close() : openDialog()}><span aria-hidden="true">✿</span></GameButton>
    {open && portalContainer.current && createPortal(<div className="settings-backdrop wardrobe-backdrop" onPointerDown={(event) => event.stopPropagation()}>
      <section ref={dialogRef} className="settings-dialog wardrobe-dialog" role="dialog" aria-modal="true" aria-labelledby="wardrobe-heading" tabIndex={-1}>
        <header className="settings-dialog-header"><h2 id="wardrobe-heading">{messages.wardrobeHeading}</h2><GameButton variant="control" className="settings-close" aria-label={messages.wardrobeCloseLabel} onClick={close}>×</GameButton></header>
        <GameWardrobePreview appearance={resolveEquipmentAppearance(draft)} imageAssets={resolveEquipmentAssets(draft)} label={messages.wardrobeHeading} />
        <div className="wardrobe-selectors">
        <fieldset className="wardrobe-options"><legend>{messages.wardrobeSkinLabel}</legend><div className="wardrobe-option-list">
          {SKIN_CATALOG.map((item) => <button key={item.id} type="button" className={`wardrobe-option${draft.skinId === item.id ? ' selected' : ''}`} aria-pressed={draft.skinId === item.id} data-dialog-initial-focus={item.id === draft.skinId ? '' : undefined} onClick={() => setDraft((current) => ({ ...current, skinId: item.id }))}><span className="wardrobe-swatch duck-swatch" style={{ backgroundColor: color(item.appearance.duck.body) }} aria-hidden="true"/><span className="wardrobe-option-copy"><span>{item.names[locale]}</span>{equipped.skinId === item.id && <small>{messages.wardrobeEquippedLabel}</small>}</span></button>)}
        </div></fieldset>
        <fieldset className="wardrobe-options"><legend>{messages.wardrobeWorldLabel}</legend><div className="wardrobe-option-list">
          {BACKGROUND_CATALOG.map((item) => <button key={item.id} type="button" className={`wardrobe-option${draft.backgroundId === item.id ? ' selected' : ''}`} aria-pressed={draft.backgroundId === item.id} onClick={() => setDraft((current) => ({ ...current, backgroundId: item.id }))}><span className="wardrobe-swatch world-swatch" style={{ background: `linear-gradient(${color(item.appearance.world.sky)} 0 55%, ${color(item.appearance.world.grass)} 55%)` }} aria-hidden="true"/><span className="wardrobe-option-copy"><span>{item.names[locale]}</span>{equipped.backgroundId === item.id && <small>{messages.wardrobeEquippedLabel}</small>}</span></button>)}
        </div></fieldset>
        </div>
        {warning && <p className="wardrobe-warning" role="status">{messages.wardrobeStorageWarning}</p>}
        <footer className="wardrobe-actions"><GameButton variant="primary" onClick={apply}>{messages.wardrobeApplyLabel}</GameButton></footer>
      </section>
    </div>, portalContainer.current)}
  </>;
}
