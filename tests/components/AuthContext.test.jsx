/**
 * src/lib/AuthContext.jsx — the renderer's authentication state machine.
 *
 * At 0% coverage (finding H-8) despite deciding, on every launch, whether the
 * app shows a login form or a waitlist full of PHI. The properties pinned here
 * are the ones whose failure is a security incident rather than a bug: a partial
 * MFA login must not produce an authenticated session, a forced password change
 * or MFA enrolment must survive into the app state that gates the UI, and a
 * logout must clear the local session even when the backend call fails.
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { auth } = vi.hoisted(() => ({
  auth: {
    isAuthenticated: vi.fn(),
    me: vi.fn(),
    login: vi.fn(),
    loginMfa: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('@/api/apiClient', () => ({ api: { auth } }));

import { AuthProvider, useAuth } from '@/lib/AuthContext';

/** Captures the context value so a test can call it directly. */
let ctx = null;

function Probe() {
  ctx = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(ctx.isAuthenticated)}</span>
      <span data-testid="loading">{String(ctx.isLoadingAuth)}</span>
      <span data-testid="user">{ctx.user ? ctx.user.email || ctx.user.id : 'none'}</span>
      <span data-testid="challenge">{ctx.mfaChallenge ? ctx.mfaChallenge.challenge_token : 'none'}</span>
      <span data-testid="must-change">{String(ctx.mustChangePassword)}</span>
      <span data-testid="must-enrol">{String(ctx.mfaEnrollmentRequired)}</span>
      <span data-testid="error">{String(ctx.authError)}</span>
    </div>
  );
}

async function renderProvider() {
  const result = render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  ctx = null;
  auth.isAuthenticated.mockResolvedValue(false);
  auth.logout.mockResolvedValue(undefined);
  window.location.hash = '';
});

describe('useAuth', () => {
  it('refuses to work outside a provider rather than returning a null session', () => {
    const Orphan = () => {
      useAuth();
      return null;
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/must be used within an AuthProvider/);
    error.mockRestore();
  });
});

describe('startup session check', () => {
  it('starts unauthenticated and stops loading', async () => {
    await renderProvider();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('restores an existing session and loads the user', async () => {
    auth.isAuthenticated.mockResolvedValue(true);
    auth.me.mockResolvedValue({ id: 'u1', email: 'coordinator@transtrack.local' });
    await renderProvider();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('coordinator@transtrack.local');
  });

  it('falls back to unauthenticated when the session check throws', async () => {
    auth.isAuthenticated.mockRejectedValue(new Error('database locked'));
    await renderProvider();
    // Failing open here would show the app shell with no session behind it.
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('falls back to unauthenticated when the user lookup throws', async () => {
    auth.isAuthenticated.mockResolvedValue(true);
    auth.me.mockRejectedValue(new Error('session expired'));
    await renderProvider();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('re-queries the backend on refreshAuth', async () => {
    await renderProvider();
    expect(ctx.refreshAuth).toBe(ctx.checkAppState);

    auth.isAuthenticated.mockResolvedValue(true);
    auth.me.mockResolvedValue({ id: 'u2', email: 'sso@transtrack.local' });
    await act(async () => { await ctx.refreshAuth(); });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('sso@transtrack.local');
  });

  it('exposes the application name and auth requirement to the login screen', async () => {
    await renderProvider();
    expect(ctx.appPublicSettings.public_settings).toEqual({ name: 'TransTrack', requires_auth: true });
    expect(ctx.isLoadingPublicSettings).toBe(false);
  });
});

describe('password login', () => {
  it('establishes a session and returns the merged result', async () => {
    auth.login.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' }, mustChangePassword: false });
    await renderProvider();

    let result;
    await act(async () => { result = await ctx.login('a@b.c', 'pw'); });
    expect(auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('must-change')).toHaveTextContent('false');
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('false');
  });

  it('accepts a bare user object from an older backend', async () => {
    auth.login.mockResolvedValue({ id: 'u1', email: 'legacy@b.c' });
    await renderProvider();
    await act(async () => { await ctx.login('legacy@b.c', 'pw'); });
    expect(screen.getByTestId('user')).toHaveTextContent('legacy@b.c');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('carries a forced password change through from either field', async () => {
    auth.login.mockResolvedValue({ user: { id: 'u1' }, mustChangePassword: true });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');

    auth.login.mockResolvedValue({ user: { id: 'u1', must_change_password: 1 } });
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');
  });

  it('carries a forced MFA enrolment through from either field', async () => {
    auth.login.mockResolvedValue({ user: { id: 'u1' }, mfaEnrollmentRequired: true });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('true');
  });

  it('requires enrolment when the account mandates MFA but has not enrolled', async () => {
    auth.login.mockResolvedValue({ user: { id: 'u1', mfa_required: true, mfa_enrolled: false } });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('true');
  });

  it('does not require enrolment for an account already enrolled', async () => {
    auth.login.mockResolvedValue({ user: { id: 'u1', mfa_required: true, mfa_enrolled: true } });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('false');
  });

  it('propagates a credential failure without recording an app-level auth error', async () => {
    auth.login.mockRejectedValue(new Error('invalid credentials'));
    await renderProvider();
    await expect(ctx.login('a@b.c', 'wrong')).rejects.toThrow('invalid credentials');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    // authError would remount Login in App.jsx and wipe the form.
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });
});

describe('MFA challenge', () => {
  it('does not authenticate on the desktop MFA-required response', async () => {
    auth.login.mockResolvedValue({ mfa_required: true, challenge_token: 'ch-1' });
    await renderProvider();

    let result;
    await act(async () => { result = await ctx.login('a@b.c', 'pw'); });
    expect(result).toEqual({ mfa_required: true });
    // The critical assertion: first factor alone is not a session.
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('challenge')).toHaveTextContent('ch-1');
    expect(ctx.mfaChallenge.email).toBe('a@b.c');
    expect(ctx.mfaChallenge.mustEnroll).toBe(false);
  });

  it('accepts the remote API challenge shape and its enrolment flag', async () => {
    auth.login.mockResolvedValue({ kind: 'mfa_required', challengeId: 'ch-2', mustEnroll: true });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('challenge')).toHaveTextContent('ch-2');
    expect(ctx.mfaChallenge.mustEnroll).toBe(true);
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('completes the login when the code verifies, sending the token under both names', async () => {
    auth.login.mockResolvedValue({ mfa_required: true, challenge_token: 'ch-1' });
    auth.loginMfa.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' } });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    await act(async () => { await ctx.submitMfa('123456'); });

    expect(auth.loginMfa).toHaveBeenCalledWith({
      challenge_token: 'ch-1',
      challengeId: 'ch-1',
      code: '123456',
    });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('challenge')).toHaveTextContent('none');
  });

  it('carries a forced password change through the MFA step', async () => {
    auth.login.mockResolvedValue({ mfa_required: true, challenge_token: 'ch-1' });
    auth.loginMfa.mockResolvedValue({ user: { id: 'u1', must_change_password: true } });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    await act(async () => { await ctx.submitMfa('123456'); });
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');
  });

  it('keeps the challenge open and stays unauthenticated on a wrong code', async () => {
    auth.login.mockResolvedValue({ mfa_required: true, challenge_token: 'ch-1' });
    auth.loginMfa.mockRejectedValue(new Error('code did not verify'));
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    await expect(ctx.submitMfa('000000')).rejects.toThrow('code did not verify');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('challenge')).toHaveTextContent('ch-1');
  });

  it('refuses a code when no challenge is in progress', async () => {
    await renderProvider();
    await expect(ctx.submitMfa('123456')).rejects.toThrow('No MFA challenge in progress');
    expect(auth.loginMfa).not.toHaveBeenCalled();
  });

  it('abandons the challenge on cancel', async () => {
    auth.login.mockResolvedValue({ mfa_required: true, challenge_token: 'ch-1' });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    await act(async () => { ctx.cancelMfa(); });
    expect(screen.getByTestId('challenge')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });
});

describe('logout', () => {
  async function loginFirst() {
    auth.login.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.c' },
      mustChangePassword: true,
      mfaEnrollmentRequired: true,
    });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
  }

  it('clears the session and returns to the login route', async () => {
    await loginFirst();
    await act(async () => { await ctx.logout(); });

    expect(auth.logout).toHaveBeenCalled();
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('must-change')).toHaveTextContent('false');
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('false');
    expect(window.location.hash).toBe('#/login');
  });

  it('clears the local session even when the backend logout fails', async () => {
    await loginFirst();
    auth.logout.mockRejectedValue(new Error('backend unreachable'));
    await act(async () => { await ctx.logout(); });
    // Leaving a rendered session up because the server was unreachable is the
    // exact failure this covers.
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(window.location.hash).toBe('#/login');
  });

  it('can clear the session without navigating', async () => {
    await loginFirst();
    window.location.hash = '#/patients';
    await act(async () => { await ctx.logout(false); });
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(window.location.hash).toBe('#/patients');
  });

  it('navigates to login on demand', async () => {
    await renderProvider();
    await act(async () => { ctx.navigateToLogin(); });
    expect(window.location.hash).toBe('#/login');
  });
});

describe('post-login gates', () => {
  it('can be cleared once the user has satisfied them', async () => {
    auth.login.mockResolvedValue({
      user: { id: 'u1' },
      mustChangePassword: true,
      mfaEnrollmentRequired: true,
    });
    await renderProvider();
    await act(async () => { await ctx.login('a@b.c', 'pw'); });
    expect(screen.getByTestId('must-change')).toHaveTextContent('true');
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('true');

    await act(async () => { ctx.clearMustChangePassword(); });
    await act(async () => { ctx.clearMfaEnrollmentRequired(); });
    expect(screen.getByTestId('must-change')).toHaveTextContent('false');
    expect(screen.getByTestId('must-enrol')).toHaveTextContent('false');
    // Clearing a gate must not disturb the session itself.
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });
});
