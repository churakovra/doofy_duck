import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = 'button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keep keyboard focus within an open dialog; its owner controls dismissal and focus restoration. */
export function useDialogKeyboard(open: boolean, dialogRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    (dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
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
  }, [open, dialogRef]);
}
