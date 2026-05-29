import type { Level } from '$lib/types';
import GeneratorWorker from './puzzleGenerator.worker?worker';

// Promise-shaped wrapper around the puzzle-generator Web Worker.
//
// Each call spawns a fresh worker, posts the dimensions, awaits a single
// `message` event with the generated `Level`, then terminates. Terminating
// instead of pooling keeps memory predictable on large grids (Ludicrous /
// Iron Tangle can hold tens of thousands of cells in flight during
// generation) at the cost of a small spin-up per call.

export function generateInWorker(w: number, h: number): Promise<Level> {
    return new Promise((resolve) => {
        const worker = new GeneratorWorker();
        worker.onmessage = (e: MessageEvent<Level>) => {
            resolve(e.data);
            worker.terminate();
        };
        worker.postMessage({ w, h });
    });
}
