import { loadJSON, saveJSON } from '$lib/utils/persisted';

// Persisted gameplay progress: per-difficulty win counts and the current /
// best win streak. These live under two separate localStorage keys (same as
// the original in-page code), so each gets its own auto-save effect.

const WINS_KEY   = 'arrow-out-progress';
const STREAK_KEY = 'arrow-out-streak';

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

const initialWins   = loadJSON<Record<string, number>>(WINS_KEY,   {}, sanitizeWins);
const initialStreak = loadJSON<Streak>                (STREAK_KEY, STREAK_DEFAULTS, sanitizeStreak);

class ProgressStore {
    wins   = $state<Record<string, number>>(initialWins);
    streak = $state<Streak>(initialStreak);
}

export const progress = new ProgressStore();

// Auto-persist on any field change. Both keys are independent so they get
// independent effects — touching the streak shouldn't rewrite the wins blob
// and vice-versa.
if (typeof window !== 'undefined') {
    $effect.root(() => {
        $effect(() => { saveJSON(WINS_KEY,   progress.wins); });
        $effect(() => { saveJSON(STREAK_KEY, progress.streak); });
    });
}
