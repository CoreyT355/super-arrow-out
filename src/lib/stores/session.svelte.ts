// ─── session / navigation store ─────────────────────────────────────────────
// Drives routing between the three screens and carries the parameters needed
// to start a new game (set by the menu, read by GameScreen on mount).

export type Screen = 'menu' | 'stats' | 'game';

interface SessionState {
	screen:            Screen;
	currentDifficulty: string | null;
	cellsRequested:    number;
	squareRequested:   boolean;
}

export const session = $state<SessionState>({
	screen:            'menu',
	currentDifficulty: null,
	cellsRequested:    81,
	squareRequested:   true,
});

export function goToMenu(): void  { session.screen = 'menu';  }
export function goToStats(): void { session.screen = 'stats'; }

export function goToGame(label: string, cells: number, square: boolean): void {
	session.currentDifficulty = label;
	session.cellsRequested    = cells;
	session.squareRequested   = square;
	session.screen            = 'game';
}
