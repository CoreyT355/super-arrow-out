import { ACHIEVEMENTS, achievementById, type Achievement } from '$lib/config/achievements';

// App-global achievement toast queue. Lives outside any screen so a toast can
// be raised from anywhere (a game win, or the dev trigger) and is rendered once
// at the app root by <AchievementToasts/>. Not persisted — purely ephemeral UI.

const TOAST_MS = 4200;

interface Toast {
    uid:         number;
    achievement: Achievement;
}

let nextUid = 0;

class ToastStore {
    items = $state<Toast[]>([]);

    show(achievement: Achievement) {
        const uid = nextUid++;
        this.items.push({ uid, achievement });
        if (typeof window !== 'undefined') {
            setTimeout(() => { this.items = this.items.filter(t => t.uid !== uid); }, TOAST_MS);
        }
    }
}

export const achievementToasts = new ToastStore();

/** Raise a toast for each achievement id (silently skips unknown ids). */
export function showAchievementToasts(ids: string[]): void {
    for (const id of ids) {
        const a = achievementById(id);
        if (a) achievementToasts.show(a);
    }
}

// Dev-only console trigger so the popup can be previewed without winning a
// game: `showAchievementToast()` for a sample, or pass an id / "all".
// Tree-shaken out of production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as typeof window & {
        showAchievementToast: (id?: string) => void;
    };
    w.showAchievementToast = (id?: string) => {
        if (id === 'all') {
            ACHIEVEMENTS.forEach(a => achievementToasts.show(a));
        } else {
            const a = id ? achievementById(id) : ACHIEVEMENTS[0];
            if (a) achievementToasts.show(a);
            else console.warn(`[dev] no achievement with id "${id}"`);
        }
    };
    console.log('[dev] showAchievementToast("id"?) — preview the achievement popup');
}
