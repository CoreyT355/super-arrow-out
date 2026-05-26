import { generateLevel } from '$lib/utils/puzzleGenerator';
import type { Level } from '$lib/types';

self.onmessage = (e: MessageEvent<{ w: number; h: number }>) => {
	const { w, h } = e.data;
	const level: Level = generateLevel(w, h);
	self.postMessage(level);
};
