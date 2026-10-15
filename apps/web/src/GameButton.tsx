import { forwardRef, type ComponentProps } from 'react';

type Props = ComponentProps<'button'> & { variant?: 'primary' | 'pause' | 'control' };

export const GameButton = forwardRef<HTMLButtonElement, Props>(function GameButton({ variant = 'primary', className, onPointerDown, ...props }, ref) {
  return <button type="button" {...props} className={`game-button ${variant}-button${className ? ` ${className}` : ''}`} onPointerDown={(event) => {
    event.stopPropagation();
    onPointerDown?.(event);
  }} ref={ref} />;
});
