/**
 * ErrorBoundary Component Tests
 *
 * Validates the global error boundary:
 * - Renders children when there is no error
 * - Catches render errors and displays fallback UI
 * - "Try Again" resets the error state
 * - Supports custom fallback render prop
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ErrorBoundary from '@/components/ErrorBoundary';

// Silence expected console.error calls from React error boundaries
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A component that always throws on render */
function ThrowingChild({ shouldThrow = true }) {
  if (shouldThrow) throw new Error('Test explosion');
  return <div>All clear</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders fallback UI when a child component throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Your data is safe/)).toBeInTheDocument();
  });

  it('renders Try Again and Reload Application buttons', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Reload Application')).toBeInTheDocument();
  });

  it('recovers when Try Again is clicked and child no longer throws', () => {
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error('boom');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing and click "Try Again"
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('uses a custom fallback render prop when provided', () => {
    const customFallback = ({ error, reset }) => (
      <div>
        <span>Custom: {error.message}</span>
        <button onClick={reset}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom: Test explosion')).toBeInTheDocument();
  });

  it('displays the support email', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    );
    expect(screen.getByText(/Trans_Track@outlook\.com/)).toBeInTheDocument();
  });
});
