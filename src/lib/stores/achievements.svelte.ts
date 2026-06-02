import { loadJSON, saveJSON } from '$lib/utils/persisted';
import {
    ACHIEVEMENTS,
    satisfiedAchievements,
    type AchievementStats,
} from '$lib/config/achievements';

// Persisted achievement progress: a map of achievement id → unlock timestamp
// (ms). Local-only, behind one localStorage key. Presence of a key means
// "unlocked"; the timestamp lets the UI show when (and order by recency).

const KEY = 'arrow-out-achievements';

function sanitize(raw: unknown): Record<string, number> | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as Record<string, number>;
}

const initial = loadJSON<Record<string, number>>(KEY, {}, sanitize);

class AchievementStore {
    unlocked = $state<Record<string, number>>(initial);
}

export const achievements = new AchievementStore();

if (typeof window !== 'undefined') {
    $effect.root(() => {
        $effect(() => { saveJSON(KEY, achievements.unlocked); });
    });
}

/** Unlock any achievement the stats now satisfy that wasn't already unlocked.
 *  Returns the ids that were *newly* unlocked, so the caller can toast them. */
export function unlockAchievements(stats: AchievementStats): string[] {
    const current = achievements.unlocked;
    const now = Date.now();
    let next: Record<string, number> | null = null;
    const newly: string[] = [];
    for (const id of satisfiedAchievements(stats)) {
        if (current[id] == null) {
            next ??= { ...current };
            next[id] = now;
            newly.push(id);
        }
    }
    if (next) achievements.unlocked = next;
    return newly;
}

/** Count of unlocked achievements (ignoring any stale ids no longer defined). */
export function unlockedCount(): number {
    return ACHIEVEMENTS.filter(a => achievements.unlocked[a.id] != null).length;
}

// Dev-only console helpers, tree-shaken out of production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as typeof window & {
        unlockAllAchievements: () => void;
        resetAchievements:     () => void;
    };
    w.unlockAllAchievements = () => {
        const now = Date.now();
        achievements.unlocked = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, now]));
        console.log(`[dev] unlocked all ${ACHIEVEMENTS.length} achievements`);
    };
    w.resetAchievements = () => {
        achievements.unlocked = {};
        console.log('[dev] achievements cleared');
    };
}
