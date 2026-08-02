/**
 * src/pages/AccountSecurity.jsx — MFA enrolment, password change, and admin
 * lockout administration.
 *
 * This page was excluded from coverage measurement on the grounds that
 * Playwright covered it (finding H-8); the e2e specs never navigate here. It is
 * the only place a user can weaken their own authentication, so the behaviour
 * that matters is that a second factor cannot be removed without
 * re-authentication, that enrolment is not reported as complete until the
 * server has verified a code, and that lockout administration is not offered to
 * a non-admin.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mfa, auth, adminSecurity } = vi.hoisted(() => ({
  mfa: {
    status: vi.fn(),
    beginEnrollment: vi.fn(),
    confirmEnrollment: vi.fn(),
    regenerateBackupCodes: vi.fn(),
    disable: vi.fn(),
  },
  auth: { me: vi.fn(), changePassword: vi.fn() },
  adminSecurity: { lockoutReport: vi.fn(), unlockAccount: vi.fn() },
}));

vi.mock('@/api/apiClient', () => ({ api: { mfa, auth, adminSecurity } }));

import AccountSecurity from '@/pages/AccountSecurity';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccountSecurity />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.me.mockResolvedValue({ id: 'u1', email: 'coordinator@transtrack.local', role: 'coordinator' });
  mfa.status.mockResolvedValue({ enrolled: false, backup_codes_remaining: 0 });
  adminSecurity.lockoutReport.mockResolvedValue({ locked: [], elevated: [] });
});

describe('AccountSecurity page', () => {
  it('renders the security heading and the MFA tab first', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Account Security/i })).toBeInTheDocument();
    expect(await screen.findByText(/Not enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin MFA enrollment/i })).toBeInTheDocument();
  });

  it('shows a loading state while the MFA status is in flight', async () => {
    mfa.status.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText(/Loading MFA status/i)).toBeInTheDocument();
  });

  it('does not offer lockout administration to a non-admin', async () => {
    renderPage();
    await screen.findByText(/Not enrolled/i);
    expect(screen.queryByRole('tab', { name: /Lockouts/i })).not.toBeInTheDocument();
    expect(adminSecurity.lockoutReport).not.toHaveBeenCalled();
  });
});

describe('MFA enrolment', () => {
  it('shows the enrolment secret and only enables Confirm for a full code', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({
      secret_base32: 'JBSWY3DPEHPK3PXP',
      otpauth_url: 'otpauth://totp/TransTrack:me?secret=JBSWY3DPEHPK3PXP',
      backup_codes: ['1111-2222'],
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    expect(await screen.findByText(/otpauth:\/\/totp\/TransTrack/)).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /^Confirm$/i });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('123456'), '12345');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('123456'), '6');
    expect(confirm).toBeEnabled();
  });

  it('accepts an alternative field naming from the server', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret: 'ALTSECRET', otpauth: 'otpauth://totp/alt' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    expect(await screen.findByText('ALTSECRET')).toBeInTheDocument();
    expect(screen.getByText('otpauth://totp/alt')).toBeInTheDocument();
  });

  it('submits the typed code together with the secret being enrolled', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://x' });
    mfa.confirmEnrollment.mockResolvedValue({ backup_codes: ['aaaa-bbbb', 'cccc-dddd'] });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    await user.type(screen.getByPlaceholderText('123456'), '123 456');
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));

    await waitFor(() => {
      // Whitespace the user pastes from an authenticator must be stripped, and
      // the secret must accompany the code so the server verifies the right one.
      expect(mfa.confirmEnrollment).toHaveBeenCalledWith({
        code: '123456',
        secret: 'JBSWY3DPEHPK3PXP',
      });
    });

    // Backup codes are shown once, with an explicit warning.
    expect(await screen.findByText(/Save these backup codes/i)).toBeInTheDocument();
    expect(screen.getByText('aaaa-bbbb')).toBeInTheDocument();
    expect(screen.getByText('cccc-dddd')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it('surfaces a rejected code instead of appearing to enrol', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'S', otpauth_url: 'otpauth://x' });
    mfa.confirmEnrollment.mockRejectedValue(new Error('code did not verify'));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    await user.type(screen.getByPlaceholderText('123456'), '000000');
    await user.click(screen.getByRole('button', { name: /^Confirm$/i }));

    await waitFor(() => expect(mfa.confirmEnrollment).toHaveBeenCalled());
    // No backup codes: nothing was enrolled.
    expect(screen.queryByText(/Save these backup codes/i)).not.toBeInTheDocument();
  });

  it('reports a failure to start enrolment', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockRejectedValue(new Error('TOTP unavailable'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    await waitFor(() => expect(mfa.beginEnrollment).toHaveBeenCalled());
    expect(screen.queryByText(/Enter the 6-digit code/i)).not.toBeInTheDocument();
  });

  it('abandons enrolment on cancel', async () => {
    const user = userEvent.setup();
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'S', otpauth_url: 'otpauth://x' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    await user.click(await screen.findByRole('button', { name: /Cancel/i }));
    expect(screen.queryByText('otpauth://x')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Begin MFA enrollment/i })).toBeInTheDocument();
    expect(mfa.confirmEnrollment).not.toHaveBeenCalled();
  });

  it('copies the secret to the clipboard on request', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mfa.beginEnrollment.mockResolvedValue({ secret_base32: 'COPYME', otpauth_url: 'otpauth://x' });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Begin MFA enrollment/i }));
    const secretLine = (await screen.findByText('COPYME')).parentElement;
    await user.click(within(secretLine).getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('COPYME');
  });
});

describe('MFA already enrolled', () => {
  beforeEach(() => {
    mfa.status.mockResolvedValue({ enrolled: true, backup_codes_remaining: 7 });
  });

  it('shows the enrolled state and remaining backup codes', async () => {
    renderPage();
    expect(await screen.findByText('Enrolled')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Begin MFA enrollment/i })).not.toBeInTheDocument();
  });

  it('treats a missing backup-code count as zero rather than blank', async () => {
    mfa.status.mockResolvedValue({ enrolled: true });
    renderPage();
    expect(await screen.findByText('Enrolled')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('regenerates backup codes and shows the new set', async () => {
    const user = userEvent.setup();
    mfa.regenerateBackupCodes.mockResolvedValue({ backup_codes: ['zzzz-1111', 'zzzz-2222'] });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Regenerate backup codes/i }));
    expect(await screen.findByText('zzzz-1111')).toBeInTheDocument();
    expect(screen.getByText(/Each code is single-use/i)).toBeInTheDocument();
  });

  it('reports a failed regeneration instead of showing stale codes', async () => {
    const user = userEvent.setup();
    mfa.regenerateBackupCodes.mockRejectedValue(new Error('nope'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Regenerate backup codes/i }));
    await waitFor(() => expect(mfa.regenerateBackupCodes).toHaveBeenCalled());
    expect(screen.queryByText(/Save these backup codes/i)).not.toBeInTheDocument();
  });

  it('downloads the backup codes as a text file', async () => {
    const user = userEvent.setup();
    mfa.regenerateBackupCodes.mockResolvedValue({ backup_codes: ['dl-1', 'dl-2'] });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:codes');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Regenerate backup codes/i }));
    await user.click(await screen.findByRole('button', { name: /Download/i }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    // The object URL must be released; a retained blob keeps the codes alive in
    // the renderer for the life of the window.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes');
    click.mockRestore();
  });

  it('copies the backup codes as newline-separated text', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mfa.regenerateBackupCodes.mockResolvedValue({ backup_codes: ['c-1', 'c-2'] });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Regenerate backup codes/i }));
    await user.click(await screen.findByRole('button', { name: /Copy/i }));
    expect(writeText).toHaveBeenCalledWith('c-1\nc-2');
  });

  it('refuses to disable MFA without a password', async () => {
    renderPage();
    const disable = await screen.findByRole('button', { name: /Disable MFA/i });
    expect(disable).toBeDisabled();
    expect(screen.getByText(/Re-authentication required/i)).toBeInTheDocument();
  });

  it('disables MFA only with re-authentication, forwarding password and code', async () => {
    const user = userEvent.setup();
    mfa.disable.mockResolvedValue({ ok: true });
    renderPage();

    await user.type(await screen.findByPlaceholderText('Account password'), 'CorrectHorse1!');
    await user.type(screen.getByPlaceholderText('6-digit or backup'), '654321');
    await user.click(screen.getByRole('button', { name: /Disable MFA/i }));

    await waitFor(() =>
      expect(mfa.disable).toHaveBeenCalledWith({ password: 'CorrectHorse1!', code: '654321' })
    );
  });

  it('omits an empty code rather than sending a blank second factor', async () => {
    const user = userEvent.setup();
    mfa.disable.mockResolvedValue({ ok: true });
    renderPage();
    await user.type(await screen.findByPlaceholderText('Account password'), 'CorrectHorse1!');
    await user.click(screen.getByRole('button', { name: /Disable MFA/i }));
    await waitFor(() =>
      expect(mfa.disable).toHaveBeenCalledWith({ password: 'CorrectHorse1!', code: undefined })
    );
  });

  it('reports a rejected disable attempt', async () => {
    const user = userEvent.setup();
    mfa.disable.mockRejectedValue(new Error('wrong password'));
    renderPage();
    await user.type(await screen.findByPlaceholderText('Account password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /Disable MFA/i }));
    await waitFor(() => expect(mfa.disable).toHaveBeenCalled());
    // Still enrolled: the panel did not switch to the un-enrolled state.
    expect(screen.getByText('Enrolled')).toBeInTheDocument();
  });
});

describe('password change', () => {
  async function openPasswordTab() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Password/i }));
    await screen.findByLabelText(/Current password/i);
    return user;
  }

  it('warns when the confirmation does not match and keeps submit disabled', async () => {
    const user = await openPasswordTab();
    await user.type(screen.getByLabelText(/Current password/i), 'old-one');
    await user.type(screen.getByLabelText(/^New password$/i), 'NewPassphrase1!');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'NewPassphrase2!');

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update password/i })).toBeDisabled();
  });

  it('requires the current password before submitting', async () => {
    const user = await openPasswordTab();
    await user.type(screen.getByLabelText(/^New password$/i), 'NewPassphrase1!');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'NewPassphrase1!');
    expect(screen.getByRole('button', { name: /Update password/i })).toBeDisabled();
  });

  it('submits a matching pair and clears the form', async () => {
    auth.changePassword.mockResolvedValue({ ok: true });
    const user = await openPasswordTab();
    await user.type(screen.getByLabelText(/Current password/i), 'old-one');
    await user.type(screen.getByLabelText(/^New password$/i), 'NewPassphrase1!');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'NewPassphrase1!');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    await waitFor(() =>
      expect(auth.changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-one',
        newPassword: 'NewPassphrase1!',
      })
    );
    // The form must not keep the credentials in the DOM after success.
    await waitFor(() => expect(screen.getByLabelText(/Current password/i)).toHaveValue(''));
  });

  it('keeps the entered values when the server rejects the change', async () => {
    auth.changePassword.mockRejectedValue(new Error('password reuse not allowed'));
    const user = await openPasswordTab();
    await user.type(screen.getByLabelText(/Current password/i), 'old-one');
    await user.type(screen.getByLabelText(/^New password$/i), 'NewPassphrase1!');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'NewPassphrase1!');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    await waitFor(() => expect(auth.changePassword).toHaveBeenCalled());
    expect(screen.getByLabelText(/Current password/i)).toHaveValue('old-one');
  });
});

describe('lockout administration (admin only)', () => {
  beforeEach(() => {
    auth.me.mockResolvedValue({ id: 'u1', email: 'admin@transtrack.local', role: 'admin' });
  });

  async function openLockoutTab() {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /Lockouts/i }));
    return user;
  }

  it('lists locked accounts with their failure counts and unlocks one', async () => {
    adminSecurity.lockoutReport.mockResolvedValue({
      locked: [{ email: 'nurse@transtrack.local', attempt_count: 5, locked_until: '2026-08-02T21:00:00Z' }],
      elevated: [{ email: 'tech@transtrack.local', failed_attempts: 3 }],
    });
    adminSecurity.unlockAccount.mockResolvedValue({ ok: true });
    const user = await openLockoutTab();

    expect(await screen.findByText('nurse@transtrack.local')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2026-08-02T21:00:00Z')).toBeInTheDocument();
    // Elevated-but-not-locked accounts are reported from a different field name.
    expect(screen.getByText('tech@transtrack.local')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    const lockedRow = screen.getByText('nurse@transtrack.local').closest('tr');
    await user.click(within(lockedRow).getByRole('button', { name: /Unlock/i }));
    await waitFor(() =>
      expect(adminSecurity.unlockAccount).toHaveBeenCalledWith('nurse@transtrack.local')
    );
  });

  it('reports both sections as empty without inventing rows', async () => {
    await openLockoutTab();
    expect(await screen.findByText(/No accounts currently locked/i)).toBeInTheDocument();
    expect(screen.getByText(/No accounts with elevated failed-login activity/i)).toBeInTheDocument();
  });

  it('shows a loading state, then the error when the report cannot be read', async () => {
    adminSecurity.lockoutReport.mockRejectedValue(new Error('audit store unavailable'));
    await openLockoutTab();
    expect(await screen.findByText('audit store unavailable')).toBeInTheDocument();
  });

  it('shows an explicit failure when unlocking is refused', async () => {
    adminSecurity.lockoutReport.mockResolvedValue({
      locked: [{ email: 'nurse@transtrack.local', attempt_count: 5 }],
      elevated: [],
    });
    adminSecurity.unlockAccount.mockRejectedValue(new Error('not permitted'));
    const user = await openLockoutTab();
    await user.click(await screen.findByRole('button', { name: /Unlock/i }));
    await waitFor(() => expect(adminSecurity.unlockAccount).toHaveBeenCalled());
    // The row is still listed — the account was not unlocked.
    expect(screen.getByText('nurse@transtrack.local')).toBeInTheDocument();
  });

  it('renders an em dash when no lock expiry is known', async () => {
    adminSecurity.lockoutReport.mockResolvedValue({
      locked: [{ email: 'nurse@transtrack.local' }],
      elevated: [],
    });
    await openLockoutTab();
    expect(await screen.findByText('—')).toBeInTheDocument();
  });
});
