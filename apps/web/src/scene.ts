import { Container, Graphics } from 'pixi.js';
import type { RunState } from '@doofy-duck/game-sim';
import { DEFAULT_APPEARANCE, type GameAppearance } from './appearance';
import { fxPosition, type Fx } from './feel';

export const WIDTH = 360;
export const HEIGHT = 580;
export const px = (value: number) => value / 1000;

export function paintWorld(
  world: Graphics,
  state: RunState,
  appearance: GameAppearance = DEFAULT_APPEARANCE,
): void {
  world.clear();
  const { pipes } = state.config;
  const ceilingY = px(pipes.ceilingY);
  const floorY = px(pipes.floorY);
  for (const pipe of state.pipes) {
    if (state.config.wetland && pipe.obstacles) {
      for (const obstacle of pipe.obstacles) {
        const x = px(pipe.x + obstacle.xOffset);
        const y = px(obstacle.y);
        const width = px(obstacle.width);
        const height = px(obstacle.height);
        const left = x - width / 2;
        if (obstacle.typeId === 'pipes') {
          world.roundRect(left, y, width, height, 7).fill(appearance.world.pipe);
          const capY = obstacle.y < pipe.gapCenter ? y + height - 10 : y;
          world.roundRect(left - 3, capY, width + 6, 10, 4).fill(appearance.world.pipeCap);
        } else if (obstacle.typeId === 'vine') {
          world.roundRect(left, y, width, height, 5).fill(appearance.world.pipe);
          world.ellipse(x, y + height - 3, width * 0.72, 5).fill(appearance.world.pipeCap);
        } else if (obstacle.typeId === 'rock') {
          world.roundRect(left, y, width, height, 7).fill(appearance.world.pipe);
          world.ellipse(x, y, width * 0.55, 5).fill(appearance.world.pipeCap);
        } else {
          world.roundRect(left, y, width, height, 8).fill(appearance.world.pipe);
          world.circle(x - width * 0.2, y + height * 0.3, Math.min(width, height) * 0.12).fill(appearance.world.pipeCap);
        }
      }
      continue;
    }
    const x = px(pipe.x);
    const gapTop = px(pipe.gapCenter - Math.floor(pipes.gapHeight / 2));
    const gapBottom = px(pipe.gapCenter + Math.floor(pipes.gapHeight / 2));
    const width = px(pipes.width);
    world.roundRect(x - width / 2, ceilingY, width, gapTop - ceilingY, 7).fill(appearance.world.pipe);
    world.roundRect(x - width / 2 - 5, gapTop - 17, width + 10, 17, 5).fill(appearance.world.pipeCap);
    world.roundRect(x - width / 2, gapBottom, width, floorY - gapBottom, 7).fill(appearance.world.pipe);
    world.roundRect(x - width / 2 - 5, gapBottom, width + 10, 17, 5).fill(appearance.world.pipeCap);
  }
  if (ceilingY > 0) world.rect(0, 0, WIDTH, ceilingY).fill(appearance.world.land);
  world.rect(0, floorY, WIDTH, HEIGHT - floorY).fill(appearance.world.land);
  world.rect(0, floorY, WIDTH, 4).fill(appearance.world.grass);
  for (const collectible of state.collectibles) {
    const x = px(collectible.x);
    const y = px(collectible.y);
    const definition = state.config.collectibles.find(item => item.typeId === collectible.typeId);
    const colors = definition && Object.hasOwn(appearance.collectibles, definition.appearance)
      ? appearance.collectibles[definition.appearance]
      : undefined;
    const palette = colors ?? appearance.fallbackCollectible;
    const radius = px(collectible.radius);
    world.circle(x, y, radius).fill(palette.outer);
    world.circle(x, y, Math.max(2, radius * 0.55)).fill(palette.inner);
  }
}

export function paintBackground(background: Graphics, appearance: GameAppearance = DEFAULT_APPEARANCE): void {
  background.clear();
  background.rect(0, 0, WIDTH, HEIGHT).fill(appearance.world.sky);
  background.circle(300, 88, 35).fill({ color: appearance.world.sun, alpha: 0.8 });
  background.ellipse(285, 505, 76, 20).fill({ color: appearance.world.cloud ?? appearance.world.land, alpha: 0.7 });
}

export function makeBackground(appearance: GameAppearance = DEFAULT_APPEARANCE): Graphics {
  const background = new Graphics();
  paintBackground(background, appearance);
  return background;
}

export function makeParallax(): Container {
  const layer = new Container();
  const marks = new Graphics();
  marks.ellipse(82, 160, 28, 5).fill({ color: 0xffffff, alpha: 0.26 });
  marks.ellipse(245, 230, 20, 4).fill({ color: 0xffffff, alpha: 0.22 });
  marks.ellipse(154, 372, 34, 5).fill({ color: 0xc1ded3, alpha: 0.28 });
  marks.ellipse(316, 430, 24, 4).fill({ color: 0xc1ded3, alpha: 0.2 });
  layer.addChild(marks);
  return layer;
}

export function paintDuck(body: Graphics, wing: Graphics, appearance: GameAppearance = DEFAULT_APPEARANCE): void {
  body.clear();
  body.ellipse(0, 0, 19, 15).fill(appearance.duck.body);
  body.moveTo(15, -4).lineTo(27, 0).lineTo(15, 4).closePath().fill(appearance.duck.beak);
  body.circle(7, -5, 2.5).fill(appearance.duck.eye);
  wing.clear();
  wing.ellipse(-3, 0, 12, 7).fill(appearance.duck.wing);
  wing.moveTo(-10, 0).lineTo(-1, 3).lineTo(5, 0).stroke({ color: appearance.duck.wingHighlight, width: 2 });
}

export function makeDuck(appearance: GameAppearance = DEFAULT_APPEARANCE): { duck: Container; body: Graphics; wing: Graphics } {
  const duck = new Container();
  const body = new Graphics();
  const wing = new Graphics();
  paintDuck(body, wing, appearance);
  wing.position.set(-5, 2);
  duck.addChild(body, wing);
  return { duck, body, wing };
}

export function paintEffects(graphic: Graphics, effects: readonly Fx[], now: number, reducedMotion: boolean): void {
  graphic.clear();
  if (reducedMotion) return;
  for (const fx of effects) {
    const pose = fxPosition(fx, now);
    if (pose.alpha <= 0) continue;
    if (fx.kind === 'pickup') {
      graphic.circle(pose.x, pose.y, 5 * pose.scale).fill({ color: 0xffe59c, alpha: pose.alpha * 0.8 });
      graphic.circle(pose.x, pose.y, 10 * pose.scale).stroke({ color: 0xf5bd56, alpha: pose.alpha * 0.65, width: 1.5 });
    } else if (fx.kind === 'air') {
      graphic.moveTo(pose.x, pose.y).lineTo(pose.x - 9 * pose.scale, pose.y + 2)
        .stroke({ color: 0xffffff, alpha: pose.alpha * 0.9, width: 2.5 });
    } else {
      graphic.circle(pose.x, pose.y, 3 * pose.scale).fill({ color: fx.kind === 'death' ? 0xe88452 : 0xffffff, alpha: pose.alpha * 0.65 });
    }
  }
}
