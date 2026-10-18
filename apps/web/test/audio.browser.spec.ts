import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import { resolve } from 'node:path';
import { installAccountBackend, prepareAccountFlight } from './account-backend.fixture';

test.beforeEach(async ({ page }) => installAccountBackend(page));

const moduleFile = resolve(process.cwd(), 'apps/web/src/audio.ts');
const audioBundle = buildSync({ entryPoints: [moduleFile], bundle: true, format: 'iife', globalName: 'AudioExports', write: false, platform: 'browser', target: 'es2020' }).outputFiles[0]!.text;

test('game UI stays silent at boot and unlocks native audio from its start button', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as typeof window & { __audioContexts?: AudioContext[]; __oscillatorCount?: number }).__audioContexts = [];
    (window as typeof window & { __oscillatorCount?: number }).__oscillatorCount = 0;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        (window as typeof window & { __audioContexts: AudioContext[] }).__audioContexts.push(this);
      }
    };
    const originalCreate = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const w = window as typeof window & { __oscillatorCount: number };
      w.__oscillatorCount += 1;
      return originalCreate.call(this);
    };
  });
  await page.goto('/');
  await prepareAccountFlight(page);
  expect(await page.evaluate(() => (window as typeof window & { __audioContexts: AudioContext[] }).__audioContexts.length)).toBe(0);
  await page.locator('.screen-panel .primary-button').click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __audioContexts: AudioContext[] }).__audioContexts[0]?.state)).toBe('running');
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __oscillatorCount: number }).__oscillatorCount)).toBeGreaterThan(0);
});

test('game audio controller flap cue renders a non-zero waveform', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: audioBundle });
  const peak = await page.evaluate(async () => {
    // Offline adapter is only for deterministic DSP rendering; autoplay is tested above
    // against the native AudioContext and a trusted Playwright click.
    class OfflineAudioContextAdapter {
      readonly offline = new OfflineAudioContext(1, 4410, 44100);
      constructor() {
        (window as typeof window & { __offlineAudioContext?: OfflineAudioContextAdapter }).__offlineAudioContext = this;
      }
      get state(): AudioContextState { return 'running'; }
      get currentTime(): number { return this.offline.currentTime; }
      get destination(): AudioDestinationNode { return this.offline.destination; }
      createOscillator(): OscillatorNode { return this.offline.createOscillator(); }
      createGain(): GainNode { return this.offline.createGain(); }
      resume(): Promise<void> { return Promise.resolve(); }
      close(): Promise<void> { return Promise.resolve(); }
    }
    window.AudioContext = OfflineAudioContextAdapter as unknown as typeof AudioContext;
    const audio = (window as typeof window & { AudioExports: { createGameAudio: (prefs: { sound: boolean; music: boolean }) => { unlockFromGesture: () => void; setPhase: (phase: string) => void; flap: () => void; dispose: () => void } } }).AudioExports.createGameAudio({ sound: true, music: false });
    audio.unlockFromGesture();
    audio.setPhase('RUNNING');
    audio.flap();
    const adapter = (window as typeof window & { __offlineAudioContext?: OfflineAudioContextAdapter }).__offlineAudioContext;
    const rendered = await adapter!.offline.startRendering();
    const samples = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    audio.dispose();
    return peak;
  });
  expect(peak).toBeGreaterThan(0.01);
});
