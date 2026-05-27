// ─── settings store ──────────────────────────────────────────────────────────

const SETTINGS_KEY = 'arrow-out-settings';

export interface Settings {
	showGrid:       boolean;
	roundedCorners: boolean;
	darkMode:       boolean;
	winAnimation:   boolean;
}

const DEFAULTS: Settings = { showGrid: true, roundedCorners: true, darkMode: true, winAnimation: true };

function loadSettings(): Settings {
	if (typeof window === 'undefined') return { ...DEFAULTS };
	try {
		const raw    = localStorage.getItem(SETTINGS_KEY);
		const parsed = raw ? JSON.parse(raw) : {};
		return {
			showGrid:       parsed.showGrid       ?? DEFAULTS.showGrid,
			roundedCorners: parsed.roundedCorners ?? DEFAULTS.roundedCorners,
			darkMode:       parsed.darkMode       ?? DEFAULTS.darkMode,
			winAnimation:   parsed.winAnimation   ?? DEFAULTS.winAnimation,
		};
	} catch { return { ...DEFAULTS }; }
}

function saveSettings(s: Settings) {
	if (typeof window === 'undefined') return;
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export const settings = $state<Settings>(loadSettings());

// Auto-persist whenever any setting changes.
$effect.root(() => {
	$effect(() => {
		saveSettings({
			showGrid:       settings.showGrid,
			roundedCorners: settings.roundedCorners,
			darkMode:       settings.darkMode,
			winAnimation:   settings.winAnimation,
		});
	});
});
