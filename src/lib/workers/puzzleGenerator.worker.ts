import { generateLevel } from '$lib/utils/puzzleGenerator';
import type { Level } from '$lib/types';

self.onmessage = (e: MessageEvent<{ w: number; h: number; shape?: string; mask?: boolean[] }>) => {
	const { w, h, shape, mask } = e.data;
	const level: Level = generateLevel(w, h, undefined, mask);
	if (shape) level.shape = shape;
	self.postMessage(level);
};
