interface KeyDownInput { code: string; repeat: boolean; targetIsButton: boolean; preventDefault(): void }
interface PointerDownInput { button: number; targetIsButton: boolean; preventDefault(): void }

export function createInputController(flap: () => void) {
  let spaceHeld = false;
  return {
    onKeyDown(event: KeyDownInput): void {
      if (event.code !== 'Space' || event.repeat || event.targetIsButton || spaceHeld) return;
      spaceHeld = true;
      event.preventDefault();
      flap();
    },
    onKeyUp(code: string): void {
      if (code === 'Space') spaceHeld = false;
    },
    onPointerDown(event: PointerDownInput): void {
      if (event.button !== 0 || event.targetIsButton) return;
      event.preventDefault();
      flap();
    },
    reset(): void {
      spaceHeld = false;
    },
  };
}
