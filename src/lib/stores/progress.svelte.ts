// ─── progress & streak store ─────────────────────────────────────────────────

import type { Level } from '$lib/types';

const STORAGE_KEY = 'arrow-out-progress';
const PUZZLE_KEY  = 'arrow-out-puzzle';
const STREAK_KEY  = 'arrow-out-streak';

// ── progress ──────────────────────────────────────────────────────────────────

function loadProgress(): Record<string, number> {
	if (typeof window === 'undefined') return {};
	try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
	catch { return {}; }
}

function saveProgress(p: Record<string, number>) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export const progress = $state<Record<string, number>>(loadProgress());

$effect.root(() => {
	$effect(() => {
		// Spread to enumerate all keys so Svelte tracks every property.
		saveProgress({ ...progress });
	});
});

// ── streak ────────────────────────────────────────────────────────────────────

function loadStreak(): { current: number; best: number } {
	if (typeof window === 'undefined') return { current: 0, best: 0 };
	try {
		const raw    = localStorage.getItem(STREAK_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return { current: parsed.current ?? 0, best: parsed.best ?? 0 };
	} catch { return { current: 0, best: 0 }; }
}

function saveStreak(s: { current: number; best: number }) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(STREAK_KEY, JSON.stringify(s));
}

export const streak = $state<{ current: number; best: number }>(loadStreak());

$effect.root(() => {
	$effect(() => {
		saveStreak({ current: streak.current, best: streak.best });
	});
});

// ── puzzle persistence (Try Again) ────────────────────────────────────────────

export function savePuzzle(lvl: Level): void {
	if (typeof window === 'undefined') return;
	try { localStorage.setItem(PUZZLE_KEY, JSON.stringify(lvl)); } catch {}
}

export function loadSavedPuzzle(): Level | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = localStorage.getItem(PUZZLE_KEY);
		return raw ? (JSON.parse(raw) as Level) : null;
	} catch { return null; }
}
