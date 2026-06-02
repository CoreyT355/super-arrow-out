// Achievement catalog. Everything is local-only (no network, no cookies) — the
// unlocked set lives in localStorage via the achievements store. Each
// achievement is a pure predicate over a stats snapshot, so unlocking is just
// "re-evaluate after every game and persist anything newly satisfied".

import { DIFFICULTIES } from './difficulties';

/** Snapshot the predicates run against — derived from the progress store. */
export interface AchievementStats {
    totalWins:        number;                  // across every difficulty + shape
    totalLosses:      number;
    bestStreak:       number;
    winsByDifficulty: Record<string, number>;  // label → wins (summed across shapes)
}

export interface Achievement {
    id:          string;
    title:       string;
    description: string;
    icon:        string;   // emoji shown in the list / toast
    /** Hidden (shown as "???") until unlocked — used for secret content. */
    secret?:     boolean;
    test:        (s: AchievementStats) => boolean;
}

// Per-difficulty flavor for the "win your first game on X" set. Generated from
// DIFFICULTIES so new difficulties get an achievement automatically; the map
// just supplies nicer titles/icons (with a sensible fallback).
const DIFFICULTY_FLAVOR: Record<string, { title: string; icon: string }> = {
    'Easy':            { title: 'Easy Does It',      icon: '🌱' },
    'Normal':          { title: 'Finding a Groove',  icon: '🎯' },
    'Hard':            { title: 'Getting Serious',   icon: '🔥' },
    'Super Hard':      { title: 'No Sweat',          icon: '💪' },
    'Expert':          { title: 'Expert Hands',      icon: '🧠' },
    'Ludicrous':       { title: 'Ludicrous Speed',   icon: '🚀' },
    'The Iron Tangle': { title: 'Untangled',         icon: '⛓️' },
};

const difficultyAchievements: Achievement[] = DIFFICULTIES.map(d => ({
    id:          `win-${d.label.toLowerCase().replace(/\s+/g, '-')}`,
    title:       DIFFICULTY_FLAVOR[d.label]?.title ?? `${d.label} Cleared`,
    description: `Win a game on ${d.label}.`,
    icon:        DIFFICULTY_FLAVOR[d.label]?.icon ?? '🏅',
    secret:      d.hidden, // the Iron Tangle is a hidden difficulty → secret
    test:        s => (s.winsByDifficulty[d.label] ?? 0) >= 1,
}));

export const ACHIEVEMENTS: Achievement[] = [
    {
        id: 'first-win', title: 'First Steps', icon: '🏆',
        description: 'Win your first game.',
        test: s => s.totalWins >= 1,
    },
    {
        id: 'first-loss', title: 'Tough Break', icon: '💥',
        description: 'Lose your first game.',
        test: s => s.totalLosses >= 1,
    },
    ...difficultyAchievements,
    {
        id: 'wins-10', title: 'Warming Up', icon: '✨',
        description: 'Win 10 games.',
        test: s => s.totalWins >= 10,
    },
    {
        id: 'wins-50', title: 'Seasoned', icon: '🎖️',
        description: 'Win 50 games.',
        test: s => s.totalWins >= 50,
    },
    {
        id: 'wins-100', title: 'Centurion', icon: '👑',
        description: 'Win 100 games.',
        test: s => s.totalWins >= 100,
    },
    {
        id: 'streak-5', title: 'On a Roll', icon: '🌟',
        description: 'Reach a 5-win streak.',
        test: s => s.bestStreak >= 5,
    },
    {
        id: 'streak-10', title: 'Unstoppable', icon: '⚡',
        description: 'Reach a 10-win streak.',
        test: s => s.bestStreak >= 10,
    },
];

export function achievementById(id: string): Achievement | undefined {
    return ACHIEVEMENTS.find(a => a.id === id);
}

/** Ids of every achievement whose predicate the stats currently satisfy. */
export function satisfiedAchievements(stats: AchievementStats): string[] {
    return ACHIEVEMENTS.filter(a => a.test(stats)).map(a => a.id);
}
