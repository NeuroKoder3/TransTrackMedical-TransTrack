/**
 * PHI Access Justification Flow — integration between the real dialog and the
 * real hook.
 *
 * REGRESSION CONTEXT: clicking "Confirm Access" used to bounce the user back to
 * the previous page without ever opening the record. Radix's AlertDialogAction
 * closes the dialog itself, so the resulting onOpenChange(false) fired the
 * cancel path while the authorization IPC was still in flight. handleCancel
 * settled the promise as cancelled first, and because a promise resolves once,
 * the real grant that arrived moments later was discarded. Every route into a
 * patient record was affected.
 *
 * The existing PatientDetails suite mocks BOTH useJustifiedAccess and
 * JustificationDialog, so the interaction between them was never exercised and
 * the bug passed CI. These tests deliberately use the real implementations of
 * both and drive them through actual user events.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import JustificationDialog from '@/components/access/JustificationDialog';
import { useJustifiedAccess } from '@/hooks/useJustifiedAccess';

const PERMISSION = 'patient:view_phi';
const ENTITY_TYPE = 'Patient';
const ENTITY_ID = 'pat-1';

/**
 * Minimal stand-in for the PatientDetails gate: request justification on mount,
 * render the real dialog, and record how the request resolved.
 */
function AccessHarness({ onResolved, onCancelSpy }) {
  const { requireJustification, dialogOpen, handleConfirm, handleCancel } = useJustifiedAccess();
  const requested = React.useRef(false);

  React.useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    requireJustification(PERMISSION, ENTITY_TYPE, ENTITY_ID).then(onResolved);
  }, [requireJustification, onResolved]);

  return (
    <JustificationDialog
      open={dialogOpen}
      onConfirm={handleConfirm}
      onCancel={() => {
        onCancelSpy();
        handleCancel();
      }}
      entityType="patient"
      action="view"
    />
  );
}

function setupIpc(impl) {
  const authorizePhiAccess = vi.fn(impl);
  window.electronAPI = { ...window.electronAPI, accessControl: { authorizePhiAccess } };
  return authorizePhiAccess;
}

describe('PHI access justification flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('grants access when a reason is chosen and Confirm Access is pressed', async () => {
    const user = userEvent.setup();
    const ipc = setupIpc(async () => ({ granted: true, grantId: 'grant-1' }));
    const onResolved = vi.fn();
    const onCancelSpy = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={onCancelSpy} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Direct patient care' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));

    // The core regression: the request must resolve as authorized, not cancelled.
    expect(onResolved.mock.calls[0][0]).toMatchObject({
      authorized: true,
      justification: 'Direct patient care',
      grantId: 'grant-1',
    });
    expect(onResolved.mock.calls[0][0].cancelled).toBeUndefined();

    expect(ipc).toHaveBeenCalledTimes(1);
    expect(ipc).toHaveBeenCalledWith({
      permission: PERMISSION,
      entityType: ENTITY_TYPE,
      entityId: ENTITY_ID,
      justification: 'Direct patient care',
    });
  });

  it('does not fire the cancel path when access is confirmed', async () => {
    // PatientDetails calls window.history.back() from onCancel, so a spurious
    // cancel is what navigated the user away from the record they opened.
    const user = userEvent.setup();
    setupIpc(async () => ({ granted: true, grantId: 'grant-2' }));
    const onResolved = vi.fn();
    const onCancelSpy = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={onCancelSpy} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Clinical review' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onCancelSpy).not.toHaveBeenCalled();
  });

  it('still resolves as authorized when the IPC is slow', async () => {
    // The original defect was a race: the dialog's close event beat the IPC.
    // Delaying the response keeps that ordering pinned.
    const user = userEvent.setup();
    setupIpc(() => new Promise((resolve) => {
      setTimeout(() => resolve({ granted: true, grantId: 'grant-slow' }), 50);
    }));
    const onResolved = vi.fn();
    const onCancelSpy = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={onCancelSpy} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Care coordination' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onResolved.mock.calls[0][0].authorized).toBe(true);
    expect(onCancelSpy).not.toHaveBeenCalled();
  });

  it('accepts a typed custom justification', async () => {
    const user = userEvent.setup();
    const ipc = setupIpc(async () => ({ granted: true, grantId: 'grant-3' }));
    const onResolved = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={vi.fn()} />);

    await screen.findByText(/Access Justification Required/i);
    await user.type(
      screen.getByPlaceholderText(/type a custom justification/i),
      'Reviewing labs ahead of transplant board'
    );
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(ipc.mock.calls[0][0].justification).toBe('Reviewing labs ahead of transplant board');
    expect(onResolved.mock.calls[0][0].authorized).toBe(true);
  });

  it('cannot be confirmed without a justification', async () => {
    const user = userEvent.setup();
    const ipc = setupIpc(async () => ({ granted: true }));
    const onResolved = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={vi.fn()} />);

    await screen.findByText(/Access Justification Required/i);
    const confirm = screen.getByRole('button', { name: /Confirm Access/i });
    expect(confirm).toBeDisabled();

    await user.click(confirm);
    expect(ipc).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('reports a denial with its reason instead of hanging', async () => {
    // A denied request must resolve too, otherwise the caller waits forever on
    // a dialog that has already closed.
    const user = userEvent.setup();
    setupIpc(async () => ({ granted: false, reason: 'Justification must be at least 10 characters' }));
    const onResolved = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={vi.fn()} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Emergency access' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onResolved.mock.calls[0][0]).toMatchObject({
      authorized: false,
      reason: 'Justification must be at least 10 characters',
    });
    // Not a cancellation — the caller needs to tell these apart to decide
    // between navigating back and showing the reason.
    expect(onResolved.mock.calls[0][0].cancelled).toBeUndefined();
  });

  it('reports a thrown IPC error as denied rather than granted', async () => {
    const user = userEvent.setup();
    setupIpc(async () => { throw new Error('Session expired. Please log in again.'); });
    const onResolved = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={vi.fn()} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Direct patient care' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onResolved.mock.calls[0][0].authorized).toBe(false);
    expect(onResolved.mock.calls[0][0].reason).toMatch(/Session expired/);
  });

  it('cancels exactly once when the Cancel button is used', async () => {
    // Cancel previously fired onCancel twice (its own onClick plus the close
    // event), so PatientDetails ran window.history.back() twice and skipped a
    // page. Exactly one cancellation must be emitted.
    const user = userEvent.setup();
    setupIpc(async () => ({ granted: true }));
    const onResolved = vi.fn();
    const onCancelSpy = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={onCancelSpy} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onCancelSpy).toHaveBeenCalledTimes(1);
    expect(onResolved.mock.calls[0][0]).toMatchObject({ authorized: false, cancelled: true });
  });

  it('treats an Escape key dismissal as a cancellation', async () => {
    const user = userEvent.setup();
    setupIpc(async () => ({ granted: true }));
    const onResolved = vi.fn();
    const onCancelSpy = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={onCancelSpy} />);

    await screen.findByText(/Access Justification Required/i);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onCancelSpy).toHaveBeenCalledTimes(1);
    expect(onResolved.mock.calls[0][0].cancelled).toBe(true);
  });

  it('resolves as authorized outside Electron, where the bridge is absent', async () => {
    const user = userEvent.setup();
    window.electronAPI = { ...window.electronAPI, accessControl: undefined };
    const onResolved = vi.fn();

    render(<AccessHarness onResolved={onResolved} onCancelSpy={vi.fn()} />);

    await screen.findByText(/Access Justification Required/i);
    await user.click(screen.getByRole('button', { name: 'Direct patient care' }));
    await user.click(screen.getByRole('button', { name: /Confirm Access/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(onResolved.mock.calls[0][0].authorized).toBe(true);
  });
});
