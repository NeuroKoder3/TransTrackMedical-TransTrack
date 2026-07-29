/**
 * Login Page Component Tests
 *
 * Validates the login form UI:
 * - Renders email and password fields
 * - Submit button is present
 * - Calls login on form submission
 * - Displays error messages on failure
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { resetApiClient } from '@/api/apiClient';

const mockLogin = vi.fn();
const mockSubmitMfa = vi.fn();
const mockCancelMfa = vi.fn();
const mockRefreshAuth = vi.fn();

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    isLoadingAuth: false,
    mfaChallenge: null,
    submitMfa: mockSubmitMfa,
    cancelMfa: mockCancelMfa,
    refreshAuth: mockRefreshAuth,
  }),
}));

import Login from '@/pages/Login';

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <Login />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('Login Page', () => {
  beforeEach(() => {
    resetApiClient();
    window.transtrackConfig = { apiBaseUrl: null };
    mockLogin.mockReset();
    mockSubmitMfa.mockReset();
    mockCancelMfa.mockReset();
    mockRefreshAuth.mockReset();
  });

  it('renders email and password inputs', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders the Sign In button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('renders the TransTrack brand name', () => {
    renderLogin();
    expect(screen.getByText('TransTrack')).toBeInTheDocument();
  });

  it('calls login with email and password on form submission', async () => {
    mockLogin.mockResolvedValueOnce({ id: '1', email: 'test@test.com' });
    renderLogin();

    const user = userEvent.setup();
    // Email is pre-filled for enterprise admin convenience — clear before typing.
    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'admin@transtrack.local');
    await user.type(screen.getByLabelText(/password/i), 'TestPassword123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@transtrack.local', 'TestPassword123!');
    });
  });

  it('displays an error message when login fails', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
    renderLogin();

    const user = userEvent.setup();
    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'bad@test.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('does not show the SSO button when SSO is unconfigured', async () => {
    renderLogin();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /sign in with your organization/i })).not.toBeInTheDocument();
    });
  });
});
