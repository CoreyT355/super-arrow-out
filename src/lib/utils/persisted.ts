// Typed JSON read/write helpers for localStorage.
//
// All three persistence stores (settings, progress, resume) read and write
// through this module so the SSR guards, JSON parse/serialize, error
// swallowing, and (optional) shape validation live in one place.
//
// The stores own the $state — these are plain functions, no runes here.

/** Load a value of type T from localStorage.
 *
 *  Returns `defaults` if:
 *   - we're on the server (no `window`),
 *   - the key is missing,
 *   - `JSON.parse` throws, OR
 *   - `sanitize` is provided and rejects the parsed value.
 *
 *  Sanitizers should return `null` to indicate "invalid; use defaults" and
 *  return a fully-shaped T otherwise. */
export function loadJSON<T>(
    key: string,
    defaults: T,
    sanitize?: (raw: unknown) => T | null,
): T {
    if (typeof window === 'undefined') return defaults;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaults;
        const parsed: unknown = JSON.parse(raw);
        if (sanitize) {
            const ok = sanitize(parsed);
            return ok ?? defaults;
        }
        return parsed as T;
    } catch {
        return defaults;
    }
}

/** Serialize and write a value to localStorage.
 *
 *  Swallows quota / serialization errors silently — persistence is a
 *  nice-to-have; the app must keep running if the browser refuses to save. */
export function saveJSON(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* quota exceeded, private-browsing block, etc. */
    }
}

/** Remove a key from localStorage. SSR-safe and error-swallowing. */
export function removeKey(key: string): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(key);
    } catch {
        /* nothing to do */
    }
}
