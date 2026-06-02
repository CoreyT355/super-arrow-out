import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, satisfiedAchievements, achievementById, type AchievementStats } from './achievements';
import { DIFFICULTIES } from './difficulties';

const empty: AchievementStats = {
    totalWins: 0, totalLosses: 0, bestStreak: 0, winsByDifficulty: {},
};

describe('achievement catalog', () => {
    it('defines at least 10 achievements with unique ids', () => {
        expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10);
        const ids = ACHIEVEMENTS.map(a => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes first win, first loss, and one per difficulty', () => {
        const ids = new Set(ACHIEVEMENTS.map(a => a.id));
        expect(ids.has('first-win')).toBe(true);
        expect(ids.has('first-loss')).toBe(true);
        for (const d of DIFFICULTIES) {
            const id = `win-${d.label.toLowerCase().replace(/\s+/g, '-')}`;
            expect(ids.has(id)).toBe(true);
        }
    });

    it('marks hidden-difficulty achievements as secret', () => {
        const ironTangle = achievementById('win-the-iron-tangle');
        expect(ironTangle?.secret).toBe(true);
        expect(achievementById('win-easy')?.secret).toBeFalsy();
    });
});

describe('satisfiedAchievements', () => {
    it('nothing unlocked from a blank slate', () => {
        expect(satisfiedAchievements(empty)).toEqual([]);
    });

    it('first win + the matching difficulty unlock together', () => {
        const got = satisfiedAchievements({
            ...empty, totalWins: 1, bestStreak: 1, winsByDifficulty: { Easy: 1 },
        });
        expect(got).toContain('first-win');
        expect(got).toContain('win-easy');
        expect(got).not.toContain('win-normal');
        expect(got).not.toContain('first-loss');
    });

    it('first loss unlocks on a loss', () => {
        expect(satisfiedAchievements({ ...empty, totalLosses: 1 })).toEqual(['first-loss']);
    });

    it('win-count milestones gate correctly', () => {
        const at = (n: number) => satisfiedAchievements({ ...empty, totalWins: n });
        expect(at(9)).not.toContain('wins-10');
        expect(at(10)).toContain('wins-10');
        expect(at(50)).toContain('wins-50');
        expect(at(50)).not.toContain('wins-100');
        expect(at(100)).toContain('wins-100');
    });

    it('streak milestones gate on best streak', () => {
        expect(satisfiedAchievements({ ...empty, bestStreak: 4 })).not.toContain('streak-5');
        expect(satisfiedAchievements({ ...empty, bestStreak: 5 })).toContain('streak-5');
        expect(satisfiedAchievements({ ...empty, bestStreak: 10 })).toContain('streak-10');
    });
});
