// Achievement catalog. Everything is local-only (no network, no cookies) — the
// unlocked set lives in localStorage via the achievements store. Each
// achievement is a pure predicate over a stats snapshot, so unlocking is just
// "re-evaluate after every game and persist anything newly satisfied".
//
// Tone is Dungeon Crawler Carl: the popup reads "New Achievement!" then the
// name, then a snarky line of System commentary (the `flavor`).

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
    /** Terse unlock requirement (shown for locked entries on the list). */
    description: string;
    /** Snarky System commentary, shown on unlock + for earned entries. */
    flavor:      string;
    icon:        string;   // emoji shown in the list / toast
    /** Hidden (shown as "???") until unlocked — used for secret content. */
    secret?:     boolean;
    test:        (s: AchievementStats) => boolean;
}

// Per-difficulty flavor for the "win your first game on X" set. Generated from
// DIFFICULTIES so new difficulties get an achievement automatically; the map
// just supplies nicer titles/icons/snark (with a sensible fallback).
const DIFFICULTY_FLAVOR: Record<string, { title: string; icon: string; flavor: string }> = {
    'Easy':            { title: 'Easy Does It',     icon: '🌱',
        flavor: 'You beat the easiest setting available. The System is contractually obligated to acknowledge this. It is not impressed.' },
    'Normal':          { title: 'Finding a Groove', icon: '🎯',
        flavor: 'A perfectly average win on a perfectly average board. The viewers did not change the channel. High praise.' },
    'Hard':            { title: 'Getting Serious',  icon: '🔥',
        flavor: 'Look at you, sweating over a grid of arrows. Production added a dramatic camera angle just for this moment.' },
    'Super Hard':      { title: 'No Sweat',         icon: '💪',
        flavor: 'Harder than Hard, because marketing ran out of adjectives. You survived it anyway. Barely. We noticed the barely.' },
    'Expert':          { title: 'Expert Hands',     icon: '🧠',
        flavor: 'Certified Expert. Your certificate is printed on premium paper and also, regrettably, on fire.' },
    'Ludicrous':       { title: 'Ludicrous Speed',  icon: '🚀',
        flavor: "You've gone to plaid. The other crawlers are taking notes. The System is mildly impressed, which is unprecedented." },
    'The Iron Tangle': { title: 'Untangled',        icon: '⛓️', // secret
        flavor: 'You untangled the impossible. The System ran the numbers three times, sighed, and updated your file. Show-off.' },
};

const difficultyAchievements: Achievement[] = DIFFICULTIES.map(d => ({
    id:          `win-${d.label.toLowerCase().replace(/\s+/g, '-')}`,
    title:       DIFFICULTY_FLAVOR[d.label]?.title ?? `${d.label} Cleared`,
    description: `Win a game on ${d.label}.`,
    flavor:      DIFFICULTY_FLAVOR[d.label]?.flavor
        ?? `You cleared ${d.label}. The System logged it somewhere it will never look again.`,
    icon:        DIFFICULTY_FLAVOR[d.label]?.icon ?? '🏅',
    secret:      d.hidden, // the Iron Tangle is a hidden difficulty → secret
    test:        s => (s.winsByDifficulty[d.label] ?? 0) >= 1,
}));

export const ACHIEVEMENTS: Achievement[] = [
    {
        id: 'first-win', title: 'First Steps', icon: '🏆',
        description: 'Win your first game.',
        flavor: 'Your very first win! The crowd pretends to care. Try not to let it go to your head, crawler.',
        test: s => s.totalWins >= 1,
    },
    {
        id: 'first-loss', title: 'Tough Break', icon: '💥',
        description: 'Lose your first game.',
        flavor: 'Your first death, and statistically not your last. Somewhere a sponsor just lowered their bid. The bloopers reel thanks you.',
        test: s => s.totalLosses >= 1,
    },
    ...difficultyAchievements,
    {
        id: 'wins-10', title: 'Warming Up', icon: '✨',
        description: 'Win 10 games.',
        flavor: "Ten wins. You're no longer a complete liability. The bar was on the floor and you stepped over it. Progress.",
        test: s => s.totalWins >= 10,
    },
    {
        id: 'wins-50', title: 'Seasoned', icon: '🎖️',
        description: 'Win 50 games.',
        flavor: 'Fifty wins. You might actually be good at this. The System refuses, on principle, to confirm or deny.',
        test: s => s.totalWins >= 50,
    },
    {
        id: 'wins-100', title: 'Centurion', icon: '👑',
        description: 'Win 100 games.',
        flavor: "One hundred wins. There is an entire dungeon out there, crawler, and you're in here clicking arrows. We respect it. We worry, but we respect it.",
        test: s => s.totalWins >= 100,
    },
    {
        id: 'streak-5', title: 'On a Roll', icon: '🌟',
        description: 'Reach a 5-win streak.',
        flavor: 'Five in a row without dying. The viewers have opened a betting pool on exactly when you choke.',
        test: s => s.bestStreak >= 5,
    },
    {
        id: 'streak-10', title: 'Unstoppable', icon: '⚡',
        description: 'Reach a 10-win streak.',
        flavor: "A ten-win streak. The System has flagged you as 'suspiciously competent.' Enjoy the attention; it never ends well.",
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
