import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VersionBadge from '../components/VersionBadge';

describe('VersionBadge', () => {
  it('renders "version unknown" when backend is unreachable', () => {
    // On first render without a cached /version response, the badge
    // should show the fallback label.
    render(<VersionBadge />);
    expect(screen.getByText('version unknown')).toBeInTheDocument();
  });

  it('has an accessible aria-label', () => {
    render(<VersionBadge />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-label');
    expect(btn.getAttribute('aria-label')).toContain('version unknown');
  });
});
