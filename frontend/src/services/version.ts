import axios from 'axios';

// API client dedicated to /version — kept separate from the main `api` client
// so that retrieving the build identity has no dependency cycle with the
// larger api.ts module (that module is heavy and re-exports many types).
const versionClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

export interface VersionInfo {
  name: string;
  version: string;
  git_sha: string;
  build_id: string; // "1.0.0+d160ce3" — canonical stamp
  build_time: string; // ISO 8601 UTC
  python_version?: string;
  platform?: string;
}

/**
 * Fetch the backend's build identity. Safe to call once per app lifetime —
 * the server response is effectively immutable while the process is running.
 */
export async function fetchVersion(): Promise<VersionInfo> {
  const { data } = await versionClient.get<VersionInfo>('/version');
  return data;
}
