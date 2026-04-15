import { useEffect, useState } from 'react';
import { fetchVersion, type VersionInfo } from '../services/version';

// Module-level cache — the backend's build identity does not change during a
// session, so we fetch it once on first access and share the result across
// every component that needs it. A `null` cache means "not yet fetched" and
// a promise-in-flight flag prevents duplicate concurrent requests.
let _cache: VersionInfo | null = null;
let _inflight: Promise<VersionInfo> | null = null;

/**
 * Return the backend build identity (version, git_sha, build_id, build_time).
 *
 * On the very first call in a session this triggers a single `/version`
 * request; thereafter every caller gets the cached object instantly. If the
 * backend is unreachable the hook returns `null` and downstream code should
 * fall back to a "version unknown" stamp.
 */
export function useVersion(): VersionInfo | null {
  const [info, setInfo] = useState<VersionInfo | null>(_cache);

  useEffect(() => {
    if (info) return;
    if (_cache) { setInfo(_cache); return; }
    if (!_inflight) {
      _inflight = fetchVersion()
        .then((v) => { _cache = v; return v; })
        .catch((e) => {
          // Swallow and surface as null. Export-stamping code will label
          // artifacts "version unknown" instead of failing the download.
          console.warn('Version fetch failed; exports will be stamped as unknown', e);
          _inflight = null;
          throw e;
        });
    }
    _inflight.then(setInfo).catch(() => setInfo(null));
  }, [info]);

  return info;
}

/**
 * Imperative sibling for code paths that are not React components — e.g. the
 * SVG export builder reads the cache synchronously when stamping a figure.
 * Returns a sentinel object so stamp text never contains literal "undefined".
 */
export function getVersionSync(): VersionInfo {
  if (_cache) return _cache;
  return {
    name: 'ORACLE',
    version: 'unknown',
    git_sha: 'unknown',
    build_id: 'unknown',
    build_time: 'unknown',
  };
}
