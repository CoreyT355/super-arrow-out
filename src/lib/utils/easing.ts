// Normalized easing functions: both expect t in [0, 1] and return [0, 1].

/** Decelerating ease: starts fast, slows to a stop. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 2;

/** Accelerating ease: starts slow, builds up. */
export const easeIn = (t: number): number => t * t;
