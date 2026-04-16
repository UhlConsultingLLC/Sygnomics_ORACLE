import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InterpretBox, InlineHelp, Metric } from '../components/Interpretation';

describe('InterpretBox', () => {
  it('renders title and children', () => {
    render(
      <InterpretBox id="test-box" title="Test Title">
        <p>Child content here</p>
      </InterpretBox>,
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Child content here')).toBeInTheDocument();
  });
});

describe('InlineHelp', () => {
  it('renders the info icon and has accessible label', () => {
    render(<InlineHelp text="Helpful tooltip text" />);
    // InlineHelp renders an italic "i" as its icon
    expect(screen.getByText('i')).toBeInTheDocument();
    // The outer span carries the full tooltip text as aria-label
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Helpful tooltip text');
  });
});

describe('Metric', () => {
  it('renders label and value', () => {
    render(<Metric label="Win Rate" value="85%" />);
    expect(screen.getByText('Win Rate')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('renders hint when provided', () => {
    render(<Metric label="NNT" value="4.2" hint="Number needed to treat" />);
    expect(screen.getByText('NNT')).toBeInTheDocument();
    expect(screen.getByText('Number needed to treat')).toBeInTheDocument();
  });
});
