import { loadJSON, saveJSON } from '$lib/utils/persisted';

// Persisted gameplay progress: per-difficulty win counts and the current /
// best win streak. These live under two separate localStorage keys (same as
// the original in-page code), so each gets its own auto-save effect.

const WINS_KEY   = 'arrow-out-progress';
const STREAK_KEY = 'arrow-out-streak';
const LOSSES_KEY = 'arrow-out-losses';

interface Streak {
    current: number;
    best:    number;
}

const STREAK_DEFAULTS: Streak = { current: 0, best: 0 };

function sanitizeWins(raw: unknown): Record<string, number> | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as Record<string, number>;
}

function sanitizeStreak(raw: unknown): Streak | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<Streak>;
    return {
        current: r.current ?? STREAK_DEFAULTS.current,
        best:    r.best    ?? STREAK_DEFAULTS.best,
    };
}

function sanitizeLosses(raw: unknown): number | null {
    return typeof raw === 'number' && raw >= 0 ? raw : null;
}

const initialWins   = loadJSON<Record<string, number>>(WINS_KEY,   {}, sanitizeWins);
const initialStreak = loadJSON<Streak>                (STREAK_KEY, STREAK_DEFAULTS, sanitizeStreak);
const initialLosses = loadJSON<number>                (LOSSES_KEY, 0, sanitizeLosses);

class ProgressStore {
    wins   = $state<Record<string, number>>(initialWins);
    streak = $state<Streak>(initialStreak);
    losses = $state<number>(initialLosses);
}

export const progress = new ProgressStore();

// Auto-persist on any field change. Both keys are independent so they get
// independent effects — touching the streak shouldn't rewrite the wins blob
// and vice-versa.
if (typeof window !== 'undefined') {
    $effect.root(() => {
        $effect(() => { saveJSON(WINS_KEY,   progress.wins); });
        $effect(() => { saveJSON(STREAK_KEY, progress.streak); });
        $effect(() => { saveJSON(LOSSES_KEY, progress.losses); });
    });
}

// Dev-only console helpers for exercising win-gated content (e.g. the secret
// Iron Tangle, which unlocks after a Ludicrous win). Assigning to
// `progress.wins` runs through the reactive graph, so the menu updates live —
// no reload needed. `import.meta.env.DEV` is statically false in a production
// build, so this whole block is tree-shaken out of the shipped bundle.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as typeof window & {
        addWin:      (label: string, n?: number) => void;
        resetWins:   () => void;
    };
    w.addWin = (label, n = 1) => {
        progress.wins = { ...progress.wins, [label]: (progress.wins[label] ?? 0) + n };
        console.log(`[dev] ${label} wins → ${progress.wins[label]}`);
    };
    w.resetWins = () => {
        progress.wins = {};
        console.log('[dev] wins cleared');
    };
    console.log('[dev] progress helpers ready: addWin("Ludicrous"), resetWins()');
}
