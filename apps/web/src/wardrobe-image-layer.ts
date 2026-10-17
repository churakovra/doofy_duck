import { Sprite, type Container, type Graphics, type Texture } from 'pixi.js';
import type { WardrobeAssetPaths } from './wardrobe';
import type { WardrobeTextures } from './wardrobe-assets';

type Props = {
  duck: Container;
  background: Graphics;
  bodyFallback: Graphics;
  wingFallback: Graphics;
};

/** Shared texture attachment and procedural fallback behavior for gameplay and preview. */
export function createWardrobeImageLayer({ duck, background, bodyFallback, wingFallback }: Props) {
  let body: Sprite | undefined;
  let wing: Sprite | undefined;
  let world: Sprite | undefined;
  const discard = (sprite: Sprite | undefined) => {
    if (sprite && !sprite.destroyed) sprite.destroy({ children: false, texture: false, textureSource: false });
  };
  const set = (key: keyof WardrobeAssetPaths, texture: Texture | undefined) => {
    if (key === 'body') {
      discard(body); body = undefined;
      if (texture) {
        body = new Sprite(texture); body.anchor.set(0.5); body.width = 64; body.height = 48;
        duck.addChildAt(body, 1);
        bodyFallback.visible = false;
      } else bodyFallback.visible = true;
    } else if (key === 'wing') {
      discard(wing); wing = undefined;
      if (texture) {
        wing = new Sprite(texture); wing.anchor.set(0.5); wing.width = 32; wing.height = 20; wing.position.set(-5, 2);
        duck.addChild(wing);
        wingFallback.visible = false;
      } else wingFallback.visible = true;
    } else {
      discard(world); world = undefined;
      if (texture) {
        world = new Sprite(texture); world.width = 360; world.height = 580;
        background.parent?.addChildAt(world, 1);
        background.visible = false;
      } else background.visible = true;
    }
  };
  return {
    setTextures(textures: WardrobeTextures) {
      set('body', textures.body); set('wing', textures.wing); set('background', textures.background);
    },
    setWingRotation(rotation: number) { if (wing) wing.rotation = rotation; },
    dispose() { discard(body); discard(wing); discard(world); body = undefined; wing = undefined; world = undefined; },
  };
}
