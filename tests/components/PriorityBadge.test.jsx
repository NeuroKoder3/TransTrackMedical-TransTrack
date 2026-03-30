/**
 * PriorityBadge Component Tests
 *
 * Validates the priority score display logic:
 * - Correct label for each severity tier (Critical / High / Medium / Low)
 * - Score rounding and rendering
 * - Icon-only mode (showLabel = false)
 * - Size variants
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PriorityBadge from '@/components/waitlist/PriorityBadge';

describe('PriorityBadge', () => {
  // -------------------------------------------------------------------------
  // Severity tier labels
  // -------------------------------------------------------------------------
  it('renders "Critical" label for score >= 80', () => {
    render(<PriorityBadge score={95} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });

  it('renders "High" label for score >= 60 and < 80', () => {
    render(<PriorityBadge score={72} />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('renders "Medium" label for score >= 40 and < 60', () => {
    render(<PriorityBadge score={50} />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders "Low" label for score < 40', () => {
    render(<PriorityBadge score={20} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  it('renders exact boundary score of 80 as Critical', () => {
    render(<PriorityBadge score={80} />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('renders exact boundary score of 60 as High', () => {
    render(<PriorityBadge score={60} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders exact boundary score of 40 as Medium', () => {
    render(<PriorityBadge score={40} />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('rounds fractional scores for display', () => {
    render(<PriorityBadge score={72.6} />);
    expect(screen.getByText('73')).toBeInTheDocument();
  });

  it('handles zero score', () => {
    render(<PriorityBadge score={0} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // showLabel = false  (icon-only mode)
  // -------------------------------------------------------------------------
  it('does not render label text when showLabel is false', () => {
    render(<PriorityBadge score={90} showLabel={false} />);
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.queryByText('90')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Size variants render without errors
  // -------------------------------------------------------------------------
  it.each(['sm', 'md', 'lg'])('renders without error at size "%s"', (size) => {
    const { container } = render(<PriorityBadge score={50} size={size} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
