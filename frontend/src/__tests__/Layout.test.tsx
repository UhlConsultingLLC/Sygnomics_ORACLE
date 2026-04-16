import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import Layout from '../components/Layout';

describe('Layout', () => {
  it('renders the Sygnomics heading', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );
    expect(screen.getByText('Sygnomics')).toBeInTheDocument();
  });

  it('renders the ORACLE heading', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('ORACLE').length).toBeGreaterThan(0);
  });

  it('renders all sidebar nav items', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );
    const expectedItems = [
      'Welcome',
      'Disease Search',
      'Trial Explorer',
      'MOA Overview',
      'Simulation',
      'Export',
    ];
    for (const label of expectedItems) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
