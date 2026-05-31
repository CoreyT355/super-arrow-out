import { loadJSON, saveJSON, removeKey } from '$lib/utils/persisted';
import type { Level } from '$lib/types';

// Persisted "resume in-progress puzzle" state. Two related keys:
//
//   arrow-out-resume → ResumeData (per-tap counters + difficulty meta)
//   arrow-out-puzzle → Level      (the exact arrow layout to restore)
//
// Both keep their own auto-save effect. `clear()` only removes the resume
// snapshot, NOT the puzzle blob — mirroring the original `clearResume()`
// behavior. The puzzle blob is overwritten whenever a new game starts.

const RESUME_KEY = 'arrow-out-resume';
const PUZZLE_KEY = 'arrow-out-puzzle';

export interface ResumeData {
    removedIds:   number[];
    markedRedIds: number[];
    lives:        number;
    difficulty:   string | null;
    W:            number;
    H:            number;
    totalArrows:  number;
}

// Sanity-check required fields so stale or pre-feature snapshots get
// silently dropped rather than crashing the resume flow.
function sanitizeResume(raw: unknown): ResumeData | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<ResumeData>;
    if (!Array.isArray(r.removedIds)) return null;
    if (typeof r.lives !== 'number') return null;
    if (!r.W || !r.H) return null;
    return {
        removedIds:   r.removedIds,
        markedRedIds: Array.isArray(r.markedRedIds) ? r.markedRedIds : [],
        lives:        r.lives,
        difficulty:   r.difficulty ?? null,
        W:            r.W,
        H:            r.H,
        totalArrows:  r.totalArrows ?? 0,
    };
}

const initialData   = loadJSON<ResumeData | null>(RESUME_KEY, null, sanitizeResume);
const initialPuzzle = loadJSON<Level | null>     (PUZZLE_KEY, null);

class ResumeStore {
    data:   ResumeData | null = $state(initialData);
    puzzle: Level      | null = $state(initialPuzzle);

    /** Drop the in-progress snapshot. Leaves the saved puzzle blob alone
     *  so "Try Again" can still restore the exact layout. */
    clear(): void {
        this.data = null;
        removeKey(RESUME_KEY);
    }
}

export const resume = new ResumeStore();

// Auto-persist on change.
//
// The resume snapshot uses `removeKey` when the value goes back to null so
// stale data doesn't linger in localStorage between sessions. The puzzle
// blob persists whenever set; null means "don't change anything" and the
// effect short-circuits, matching the original code (which only ever
// CALLED savePuzzle with a real Level).
if (typeof window !== 'undefined') {
    $effect.root(() => {
        $effect(() => {
            if (resume.data === null) {
                removeKey(RESUME_KEY);
            } else {
                saveJSON(RESUME_KEY, resume.data);
            }
        });
        $effect(() => {
            if (resume.puzzle !== null) {
                saveJSON(PUZZLE_KEY, resume.puzzle);
            }
        });
    });
}
