import { useState, useEffect, useCallback } from 'react';

/**
 * Persists arbitrary JSON-serializable state to sessionStorage so values
 * survive React Router unmounts. Returns a [state, setter, reset] triple
 * matching React.useState semantics, plus a reset that clears the entry.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      return parsed as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota or serialization error — ignore */
    }
  }, [key, state]);

  const reset = useCallback(() => {
    try { sessionStorage.removeItem(key); } catch { /* noop */ }
    setState(initial);
    // We intentionally exclude `initial` from deps to keep reset stable;
    // callers should pass a stable initial value (object literal in module
    // scope or memoized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [state, setState, reset];
}

/** Convenience: clear several persistent keys at once. */
export function clearPersistentKeys(...keys: string[]) {
  for (const k of keys) {
    try { sessionStorage.removeItem(k); } catch { /* noop */ }
  }
}
