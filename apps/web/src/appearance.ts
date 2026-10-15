export type CollectibleAppearance = { readonly outer: number; readonly inner: number };

/** Renderer colors only; this data never participates in simulation identity. */
export type GameAppearance = {
  readonly duck: {
    readonly body: number;
    readonly beak: number;
    readonly eye: number;
    readonly wing: number;
    readonly wingHighlight: number;
  };
  readonly world: {
    readonly sky: number;
    readonly sun: number;
    readonly land: number;
    readonly cloud?: number;
    readonly grass: number;
    readonly pipe: number;
    readonly pipeCap: number;
  };
  readonly collectibles: Readonly<Record<string, CollectibleAppearance>>;
  readonly fallbackCollectible: CollectibleAppearance;
};

export const DEFAULT_APPEARANCE: GameAppearance = Object.freeze({
  duck: Object.freeze({
    body: 0xffd267,
    beak: 0xe88452,
    eye: 0x33423b,
    wing: 0xe99b39,
    wingHighlight: 0xffe09b,
  }),
  world: Object.freeze({
    sky: 0xdff3ec,
    sun: 0xffd98b,
    land: 0xe6c78e,
    cloud: 0xbedbd1,
    grass: 0xb1c988,
    pipe: 0x5e9b81,
    pipeCap: 0x427c65,
  }),
  collectibles: Object.freeze({
    'feather-v1': Object.freeze({ outer: 0xfffbdf, inner: 0xd8aa66 }),
    'game-star-v1': Object.freeze({ outer: 0xf5bd56, inner: 0xffe59c }),
  }),
  fallbackCollectible: Object.freeze({ outer: 0xfffbdf, inner: 0xd8aa66 }),
});
