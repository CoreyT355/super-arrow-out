import { loadJSON, saveJSON } from '$lib/utils/persisted';

// Persisted user settings. Lives behind a single localStorage key. Every
// boolean defaults to `true` because the app's first-run UX assumes the
// "rich" experience (dark mode, grid lines, rounded snake corners, win
// vortex animation).

const KEY = 'arrow-out-settings';

interface SettingsShape {
    showGrid: boolean;
    roundedCorners: boolean;
    darkMode: boolean;
    winAnimation: boolean;
}

const DEFAULTS: SettingsShape = {
    showGrid: true,
    roundedCorners: true,
    darkMode: true,
    winAnimation: true,
};

// Tolerant of partial / corrupt blobs from older clients — any missing
// field falls back to its default. This mirrors the original loadSettings()
// behavior exactly.
function sanitize(raw: unknown): SettingsShape | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<SettingsShape>;
    return {
        showGrid:       r.showGrid       ?? DEFAULTS.showGrid,
        roundedCorners: r.roundedCorners ?? DEFAULTS.roundedCorners,
        darkMode:       r.darkMode       ?? DEFAULTS.darkMode,
        winAnimation:   r.winAnimation   ?? DEFAULTS.winAnimation,
    };
}

const initial = loadJSON<SettingsShape>(KEY, DEFAULTS, sanitize);

class SettingsStore {
    showGrid       = $state(initial.showGrid);
    roundedCorners = $state(initial.roundedCorners);
    darkMode       = $state(initial.darkMode);
    winAnimation   = $state(initial.winAnimation);
}

export const settings = new SettingsStore();

// Auto-persist any change. Lives in a root effect so it survives component
// mounts/unmounts; runs only on the client. Reads each field so $effect
// tracks all of them.
if (typeof window !== 'undefined') {
    $effect.root(() => {
        $effect(() => {
            saveJSON(KEY, {
                showGrid:       settings.showGrid,
                roundedCorners: settings.roundedCorners,
                darkMode:       settings.darkMode,
                winAnimation:   settings.winAnimation,
            });
        });
    });
}
