import { describe, it, expect } from 'vitest';
import { winKey, parseWinKey, winsForDifficulty } from './winKey';

describe('winKey', () => {
    it('returns the bare label for classic / no shape', () => {
        expect(winKey('Normal')).toBe('Normal');
        expect(winKey('Normal', null)).toBe('Normal');
        expect(winKey('Normal', undefined)).toBe('Normal');
        expect(winKey('Normal', 'classic')).toBe('Normal');
    });

    it('appends the shape id for shaped wins', () => {
        expect(winKey('Normal', 'heart')).toBe('Normal#heart');
        expect(winKey('Ludicrous', 'diamond')).toBe('Ludicrous#diamond');
    });
});

describe('parseWinKey', () => {
    it('splits bare and composite keys', () => {
        expect(parseWinKey('Normal')).toEqual({ difficulty: 'Normal', shapeId: null });
        expect(parseWinKey('Normal#heart')).toEqual({ difficulty: 'Normal', shapeId: 'heart' });
    });

    it('round-trips with winKey', () => {
        const k = winKey('Expert', 'circle');
        expect(parseWinKey(k)).toEqual({ difficulty: 'Expert', shapeId: 'circle' });
    });
});

describe('winsForDifficulty', () => {
    it('sums bare and composite keys for one difficulty', () => {
        const wins = {
            Normal: 3,
            'Normal#heart': 2,
            'Normal#diamond': 1,
            Hard: 5,
            'Hard#circle': 4,
        };
        expect(winsForDifficulty(wins, 'Normal')).toBe(6);
        expect(winsForDifficulty(wins, 'Hard')).toBe(9);
        expect(winsForDifficulty(wins, 'Easy')).toBe(0);
    });

    it('does not match difficulties that are prefixes of others', () => {
        // "Hard" must not pick up "Super Hard" wins.
        const wins = { Hard: 2, 'Super Hard': 7, 'Super Hard#heart': 1 };
        expect(winsForDifficulty(wins, 'Hard')).toBe(2);
        expect(winsForDifficulty(wins, 'Super Hard')).toBe(8);
    });
});
