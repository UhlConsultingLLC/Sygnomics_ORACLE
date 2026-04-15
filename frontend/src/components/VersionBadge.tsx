import { useState } from 'react';
import { useVersion } from '../hooks/useVersion';

/**
 * Small provenance chip rendered in the app sidebar footer.
 *
 * Renders as `ORACLE v1.0.0 · d160ce3`. Click to copy the full build_id to
 * the clipboard; hover to reveal build time, Python version, platform.
 * When the backend is unreachable the chip shows `version unknown` in grey
 * so the user can tell at a glance that provenance is not being stamped.
 */
export default function VersionBadge() {
  const info = useVersion();
  const [copied, setCopied] = useState(false);

  const label = info
    ? `${info.name} v${info.version} · ${info.git_sha}`
    : 'version unknown';
  const buildId = info ? info.build_id : '';

  const handleCopy = async () => {
    if (!buildId) return;
    try {
      await navigator.clipboard.writeText(buildId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  const title = info
    ? [
        `Build ID: ${info.build_id}`,
        `Built: ${info.build_time}`,
        info.python_version ? `Python: ${info.python_version}` : '',
        info.platform ? `Platform: ${info.platform}` : '',
        '',
        'Click to copy build ID',
      ].filter(Boolean).join('\n')
    : 'Backend /version endpoint did not respond. Exports will not be stamped with a build ID.';

  return (
    <button
      onClick={handleCopy}
      title={title}
      aria-label={`App build identity: ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        border: `1px solid ${info ? '#cdd4df' : '#e0c2c2'}`,
        borderRadius: 999,
        background: copied ? '#e7f4e9' : '#fff',
        color: info ? '#1c3e72' : '#b45757',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: 11,
        cursor: buildId ? 'pointer' : 'default',
        transition: 'background 160ms',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: info ? '#2e7d32' : '#c62828',
        }}
      />
      {copied ? 'copied!' : label}
    </button>
  );
}
