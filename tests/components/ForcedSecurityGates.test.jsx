/**
 * src/pages/ForceMfaEnrollment.jsx and src/pages/ForcePasswordChange.jsx — the
 * two blocking screens AuthContext renders instead of the application when an
 * account has an outstanding security obligation.
 *
 * Both were at 0% coverage (finding H-8). They are the enforcement point for two
 * organizational policies: "this role must have a second factor" and "this
 * credential must be replaced before use". The failure mode that matters is not
 * a visual one — it is either screen letting the user through without the
 * obligation actually being met, because the only thing standing between a
 * temporary password and a live PHI session is the clear* callback these pages
 * decide to invoke.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mfa, auth, authState } = vi.hoisted(() => ({
  mfa: { beginEnrollment: vi.fn(), confirmEnrollment: vi.fn() },
  auth: { changePassword: vi.fn() },
  authState: {
    logout: vi.fn(),
    clearMfaEnrollmentRequired: vi.fn(),
    clearMustChangePassword: vi.fn(),
  },
}));

vi.mock('@/api/apiClient', () => ({ api: { mfa, auth } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => authState }));

import ForceMfaEnrollment from '@/pages/ForceMfaEnrollment';
import ForcePasswordChange from '@/pages/ForcePasswordChange';

function renderWithQuery(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForceMfaEnrollment', () => {
  it('explains why the application is blocked and offers only setup or logout', () => {
    renderWithQuery(<ForceMfaEnrollment />);
    expect(screen.getByText(/Multi-Factor Authentication Required/i)).toBeInTheDocument();
    expect(screen.getByText(/requires MFA enrollment before you can continue/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin MFA Setup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Log Out$/i })).toBeInTheDocument();
    // No way past the gate exists before enrollment starts.
    expect(screen.queryByRole('button', { name: /Verify & Enable/i })).not.toBeInTheDocument();
    expect(authState.clearMfaEnrollmentRequired).not.toHaveBeenCalled();
  });

  it('shows the shared secret so an authenticator can be set up by hand', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({
      secret_base32: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/TransTrack:nurse@example.org?secret=JBSWY3DPEHPK3PXP',
    });

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText(/Advanced: otpauth URI/i)).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp\/TransTrack/)).toBeInTheDocument();
  });

  it('accepts the server\'s alternative payload shape', async () => {
    const user = userEvent.setup();
    // The desktop IPC handler returns `secret`/`otpauth`; the multi-tenant
    // server returns `secret_base32`/`otpauth_url`. A page that only understood
    // one would render a blank secret against the other.
    mfa.beginEnrollment.mockResolvedValue({ secret: 'MZXW6YTBOI======', otpauth: '' });

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));

    expect(await screen.findByText('MZXW6YTBOI======')).toBeInTheDocument();
    // No otpauth URI in this payload, so the disclosure is not offered.
    expect(screen.queryByText(/Advanced: otpauth URI/i)).not.toBeInTheDocument();
  });

  it('keeps the code field numeric and Verify disabled until six digits are present', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');

    const verify = screen.getByRole('button', { name: /Verify & Enable/i });
    expect(verify).toBeDisabled();

    const code = screen.getByPlaceholderText('000000');
    await user.type(code, '12a3b4');
    expect(code).toHaveValue('1234');
    expect(verify).toBeDisabled();

    await user.type(code, '56');
    expect(code).toHaveValue('123456');
    expect(verify).toBeEnabled();
  });

  it('does not release the gate until the server has verified the code', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });
    mfa.confirmEnrollment.mockResolvedValue({ backup_codes: ['1111-2222', '3333-4444'] });

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /Verify & Enable/i }));

    await waitFor(() => expect(mfa.confirmEnrollment).toHaveBeenCalledWith({
      code: '123456',
      secret: 'JBSWY3DPEHPK3PXP',
    }));

    // Backup codes are shown once, and the gate is still closed until the user
    // confirms they have been saved.
    expect(await screen.findByText(/MFA Enabled/i)).toBeInTheDocument();
    expect(screen.getByText('1111-2222')).toBeInTheDocument();
    expect(screen.getByText('3333-4444')).toBeInTheDocument();
    expect(authState.clearMfaEnrollmentRequired).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /I have saved my backup codes/i }));
    expect(authState.clearMfaEnrollmentRequired).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected code and keeps the gate closed', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });
    mfa.confirmEnrollment.mockRejectedValue(new Error('Invalid verification code'));

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByPlaceholderText('000000'), '000000');
    await user.click(screen.getByRole('button', { name: /Verify & Enable/i }));

    expect(await screen.findByText('Invalid verification code')).toBeInTheDocument();
    expect(screen.queryByText(/MFA Enabled/i)).not.toBeInTheDocument();
    expect(authState.clearMfaEnrollmentRequired).not.toHaveBeenCalled();
  });

  it('reports a failure to start enrollment', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockRejectedValue(new Error('MFA service unavailable'));

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));

    expect(await screen.findByText('MFA service unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin MFA Setup/i })).toBeInTheDocument();
  });

  it('starting over clears the secret, the code and the error', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });
    mfa.confirmEnrollment.mockRejectedValue(new Error('Invalid verification code'));

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByPlaceholderText('000000'), '000000');
    await user.click(screen.getByRole('button', { name: /Verify & Enable/i }));
    await screen.findByText('Invalid verification code');

    await user.click(screen.getByRole('button', { name: /Start over/i }));

    expect(screen.queryByText('JBSWY3DPEHPK3PXP')).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid verification code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin MFA Setup/i })).toBeInTheDocument();
  });

  it('still enables MFA when the server returns no backup codes', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });
    mfa.confirmEnrollment.mockResolvedValue({});

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /Verify & Enable/i }));

    expect(await screen.findByText(/No backup codes returned/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /I have saved my backup codes/i }));
    expect(authState.clearMfaEnrollmentRequired).toHaveBeenCalledTimes(1);
  });

  it('copies a backup code to the clipboard without leaving it on screen', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP' });
    mfa.confirmEnrollment.mockResolvedValue({ backupCodes: ['9999-8888'] });

    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /Begin MFA Setup/i }));
    await screen.findByText('JBSWY3DPEHPK3PXP');
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: /Verify & Enable/i }));
    await screen.findByText('9999-8888');

    const copyButtons = screen.getAllByRole('button').filter((b) => b.className.includes('text-slate-400'));
    await user.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith('9999-8888');
  });

  it('logs out with the involuntary flag rather than dropping to the application', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ForceMfaEnrollment />);
    await user.click(screen.getByRole('button', { name: /^Log Out$/i }));
    expect(authState.logout).toHaveBeenCalledWith(true);
    expect(authState.clearMfaEnrollmentRequired).not.toHaveBeenCalled();
  });
});

describe('ForcePasswordChange', () => {
  // The three labels on this form carry no htmlFor and the inputs carry no id,
  // so getByLabelText cannot reach them. Selected positionally instead, in the
  // document order they are rendered in: current, new, confirm.
  let container = null;

  function renderGate() {
    ({ container } = render(<ForcePasswordChange />));
  }

  function fields() {
    const inputs = container.querySelectorAll('input[type="password"]');
    expect(inputs).toHaveLength(3);
    return { current: inputs[0], next: inputs[1], confirm: inputs[2] };
  }

  it('states the requirement and the policy', () => {
    renderGate();
    expect(screen.getByText(/Password Change Required/i)).toBeInTheDocument();
    expect(screen.getByText(/At least 12 characters with uppercase, lowercase, number, and special character/i))
      .toBeInTheDocument();
    expect(fields().next).toHaveAttribute('minLength', '12');
    // Credentials are never rendered in clear text.
    for (const input of Object.values(fields())) {
      expect(input).toHaveAttribute('type', 'password');
    }
  });

  it('rejects a mismatched confirmation locally, without calling the API', async () => {
    const user = userEvent.setup();
    renderGate();

    await user.type(fields().current, 'OldPassw0rd!123');
    await user.type(fields().next, 'NewPassw0rd!123');
    await user.type(fields().confirm, 'NewPassw0rd!124');
    await user.click(screen.getByRole('button', { name: /Change Password/i }));

    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument();
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(authState.clearMustChangePassword).not.toHaveBeenCalled();
  });

  it('releases the gate only after the change is accepted', async () => {
    const user = userEvent.setup();
    auth.changePassword.mockResolvedValue({ success: true });
    renderGate();

    await user.type(fields().current, 'OldPassw0rd!123');
    await user.type(fields().next, 'NewPassw0rd!123');
    await user.type(fields().confirm, 'NewPassw0rd!123');
    await user.click(screen.getByRole('button', { name: /Change Password/i }));

    await waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPassw0rd!123',
      newPassword: 'NewPassw0rd!123',
    }));
    await waitFor(() => expect(authState.clearMustChangePassword).toHaveBeenCalledTimes(1));
  });

  it('keeps the gate closed when the server rejects the change', async () => {
    const user = userEvent.setup();
    auth.changePassword.mockRejectedValue(new Error('Password was used in the last 12 changes'));
    renderGate();

    await user.type(fields().current, 'OldPassw0rd!123');
    await user.type(fields().next, 'NewPassw0rd!123');
    await user.type(fields().confirm, 'NewPassw0rd!123');
    await user.click(screen.getByRole('button', { name: /Change Password/i }));

    expect(await screen.findByText('Password was used in the last 12 changes')).toBeInTheDocument();
    expect(authState.clearMustChangePassword).not.toHaveBeenCalled();
    // Still usable for another attempt.
    expect(screen.getByRole('button', { name: /Change Password/i })).toBeEnabled();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    const user = userEvent.setup();
    auth.changePassword.mockRejectedValue(new Error(''));
    renderGate();

    await user.type(fields().current, 'OldPassw0rd!123');
    await user.type(fields().next, 'NewPassw0rd!123');
    await user.type(fields().confirm, 'NewPassw0rd!123');
    await user.click(screen.getByRole('button', { name: /Change Password/i }));

    expect(await screen.findByText('Failed to change password.')).toBeInTheDocument();
  });

  it('disables submission while the change is in flight', async () => {
    const user = userEvent.setup();
    let resolve;
    auth.changePassword.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderGate();

    await user.type(fields().current, 'OldPassw0rd!123');
    await user.type(fields().next, 'NewPassw0rd!123');
    await user.type(fields().confirm, 'NewPassw0rd!123');
    await user.click(screen.getByRole('button', { name: /Change Password/i }));

    // A second click here would submit the same change twice, and with password
    // history enforcement the second attempt fails and shows the user an error
    // for a change that actually succeeded.
    expect(await screen.findByRole('button', { name: /Changing\.\.\./i })).toBeDisabled();
    resolve({ success: true });
    await waitFor(() => expect(authState.clearMustChangePassword).toHaveBeenCalled());
  });

  it('logs out with the involuntary flag', async () => {
    const user = userEvent.setup();
    renderGate();
    await user.click(screen.getByRole('button', { name: /Log Out/i }));
    expect(authState.logout).toHaveBeenCalledWith(true);
    expect(authState.clearMustChangePassword).not.toHaveBeenCalled();
  });
});
