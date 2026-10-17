import { DEFAULT_CONFIG } from "./config.js";
import { deepFreeze } from "./internal.js";
import { type CollectibleDefinition, type GameEvent } from "./types.js";

export abstract class CollectibleType {
  abstract readonly definition: CollectibleDefinition;
  get typeId(): string {
    return this.definition.typeId;
  }
  pickup(
    runId: string,
    collectibleId: string,
    tick: number,
  ): Extract<GameEvent, { type: "CurrencyCollected" }> {
    return {
      type: "CurrencyCollected",
      runId,
      collectibleId,
      typeId: this.typeId,
      amount: this.definition.amount,
      tick,
    };
  }
}
export class Feather extends CollectibleType {
  constructor(
    readonly definition: CollectibleDefinition = DEFAULT_CONFIG
      .collectibles[0]!,
  ) {
    super();
  }
}
export class GameStar extends CollectibleType {
  constructor(
    readonly definition: CollectibleDefinition = DEFAULT_CONFIG.collectibles[1]!,
  ) {
    super();
  }
}
class DefinedCollectible extends CollectibleType {
  constructor(readonly definition: CollectibleDefinition) {
    super();
  }
}
export function collectibleFromDefinition(
  d: CollectibleDefinition,
): CollectibleType {
  const checked = deepFreeze({ ...d });
  if (checked.typeId === "FEATHER") return new Feather(checked);
  if (checked.typeId === "GAME_STAR") return new GameStar(checked);
  return new DefinedCollectible(checked);
}
