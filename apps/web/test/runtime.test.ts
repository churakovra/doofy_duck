import { describe, expect, it, vi } from 'vitest';
import { FixedStepClock } from '../src/clock';
import { createInputController } from '../src/input';
import { readBest, writeBest } from '../src/storage';

describe('fixed-step clock', () => {
  it('pauses before executing an overloaded frame after sustained slow frames', () => {
    const ticks: number[] = [];
    const clock = new FixedStepClock((tick) => ticks.push(tick));
    clock.advance(200);
    expect(ticks).toHaveLength(5);
    clock.advance(150);
    expect(ticks).toHaveLength(5);
    expect(clock.takePauseRequest()).toBe(true);
    expect(clock.interpolation).toBe(0);
    clock.advance(17);
    expect(ticks).toHaveLength(5);
    expect(clock.takePauseRequest()).toBe(false);
    clock.resume();
    clock.advance(17);
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps large-gap overload latched and clears its notification on resume', () => {
    const onTick = vi.fn();
    const clock = new FixedStepClock(onTick);
    clock.advance(251);
    clock.advance(50);
    expect(onTick).not.toHaveBeenCalled();
    clock.resume();
    expect(clock.takePauseRequest()).toBe(false);
    clock.advance(50);
    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('bounds interpolation while carrying permitted debt and ignores invalid elapsed time', () => {
    const onTick = vi.fn();
    const clock = new FixedStepClock(onTick);
    for (const elapsed of [-1, NaN, Infinity]) clock.advance(elapsed);
    expect(onTick).not.toHaveBeenCalled();
    clock.advance(250);
    expect(onTick).toHaveBeenCalledTimes(5);
    expect(clock.takePauseRequest()).toBe(false);
    expect(clock.interpolation).toBe(1);
    clock.resume();
    clock.advance(8);
    expect(clock.interpolation).toBeCloseTo(0.48);
  });

  it('advances only whole 60Hz steps and never exceeds per-frame work bound', () => {
    const ticks: number[] = [];
    const clock = new FixedStepClock((tick) => ticks.push(tick));
    clock.advance(50);
    expect(ticks).toHaveLength(3);
    clock.advance(1_000);
    expect(clock.takePauseRequest()).toBe(true);
    expect(ticks).toHaveLength(3);
    clock.resume();
    clock.advance(17);
    expect(ticks).toHaveLength(4);
  });
});

describe('input controller', () => {
  it('ignores repeated Space keydown until keyup but accepts the next press', () => {
    const flap = vi.fn();
    const controller = createInputController(flap);
    controller.onKeyDown({ code: 'Space', repeat: false, targetIsButton: false, preventDefault: vi.fn() });
    controller.onKeyDown({ code: 'Space', repeat: true, targetIsButton: false, preventDefault: vi.fn() });
    controller.onKeyUp('Space');
    controller.onKeyDown({ code: 'Space', repeat: false, targetIsButton: false, preventDefault: vi.fn() });
    expect(flap).toHaveBeenCalledTimes(2);
  });

  it('does not convert screen-control clicks into a play action', () => {
    const flap = vi.fn();
    const controller = createInputController(flap);
    controller.onPointerDown({ button: 0, targetIsButton: true, preventDefault: vi.fn() });
    controller.onPointerDown({ button: 0, targetIsButton: false, preventDefault: vi.fn() });
    expect(flap).toHaveBeenCalledTimes(1);
  });
});

describe('personal best storage', () => {
  it('accepts only valid values and survives unavailable or malformed storage', () => {
    const storage = { value: '', getItem: vi.fn(() => storage.value), setItem: vi.fn((_k: string, v: string) => { storage.value = v; }) };
    expect(readBest(storage)).toBe(0);
    writeBest(storage, 12);
    expect(readBest(storage)).toBe(12);
    storage.value = '{bad';
    expect(readBest(storage)).toBe(0);
    expect(readBest({ getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } })).toBe(0);
    expect(writeBest({ getItem: () => null, setItem: () => { throw Error('quota'); } }, 99)).toBe(false);
  });
});
