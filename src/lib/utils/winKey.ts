// Win-record keys are composite so progress can be tracked per shape without
// breaking the original per-difficulty model. A classic (rectangle) win is
// stored under the bare difficulty label — exactly as before — while a shaped
// win appends "#<shapeId>":
//
//   "Normal"        → classic Normal win
//   "Normal#heart"  → Normal win on the heart shape
//
// Keeping the classic form bare means old saved progress (which only ever held
// bare labels) keeps counting and the stats donut stays back-compatible.

/** Composite win key. Classic / undefined shape → bare difficulty label. */
export function winKey(difficultyLabel: string, shapeId?: string | null): string {
    return shapeId && shapeId !== 'classic'
        ? `${difficultyLabel}#${shapeId}`
        : difficultyLabel;
}

/** Split a (possibly composite) key back into its difficulty + shape parts.
 *  Bare keys return `shapeId: null`. */
export function parseWinKey(key: string): { difficulty: string; shapeId: string | null } {
    const hash = key.indexOf('#');
    return hash === -1
        ? { difficulty: key, shapeId: null }
        : { difficulty: key.slice(0, hash), shapeId: key.slice(hash + 1) };
}

/** Total wins for a difficulty across every shape (bare + all composite keys). */
export function winsForDifficulty(wins: Record<string, number>, label: string): number {
    let total = 0;
    for (const [key, n] of Object.entries(wins)) {
        if (parseWinKey(key).difficulty === label) total += n;
    }
    return total;
}
