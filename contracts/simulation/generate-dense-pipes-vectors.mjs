// Generate catalog-10 geometry vectors after build:sim.
import { writeFileSync } from 'node:fs';
import { createRun, createRunDescriptor, generateNext, DENSE_PIPES_DEFAULT_CONFIG } from '../../packages/game-sim/dist/index.js';
const cases = [];
const profiles = [0, 1, 42, 4294967295].flatMap(seed => [2, 3, 4, 5, 6].map(block => ({ seed, block })));
profiles.push({ seed: 2, block: 18 });
for (const { seed, block } of profiles) {
  const state = createRun(createRunDescriptor({ runId: 'vector', seed }, DENSE_PIPES_DEFAULT_CONFIG));
  const pipes = generateNext({ ...state, pipes: [], nextPipeIndex: block * 4, nextPipeX: 100_000, lastGapCenter: 280_000 }).state.pipes.slice(0, 4);
  cases.push({ seed, block, centers: pipes.map(pipe => pipe.gapCenter), spacings: pipes.map(pipe => pipe.stationSpacing) });
}
writeFileSync(new URL('./dense-pipes-v1.json', import.meta.url), JSON.stringify({ cases }, null, 2) + '\n');
