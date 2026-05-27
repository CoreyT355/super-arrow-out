// ─── timing constants ────────────────────────────────────────────────────────

export const MS_PER_STEP     = 90;
export const NUDGE_FWD       = 140; // ms to nudge toward blocker
export const NUDGE_BACK      = 140; // ms to spring back
export const FLASH_HALF      =  90; // ms per flash half (×4 = total flash duration)
export const EXIT_DURATION   = 450; // ms — constant drain duration regardless of snake length
export const EXIT_MIN_DUR    = 220; // ms — floor so a 1-cell snake at the edge isn't instant
export const MAX_LIVES       =   3;

export const VORTEX_DURATION = 2000; // ms — win collapse animation (fade-in + spiral)
export const VORTEX_FADE_MS  =  600; // ms — stars fade in from nothing during this phase
export const VORTEX_SPIN_MS  = VORTEX_DURATION - VORTEX_FADE_MS; // 1400ms — spiral with ease-in
