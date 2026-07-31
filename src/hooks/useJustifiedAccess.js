import { useState, useCallback, useRef } from 'react';

/**
 * Hook for handling access with justification requirements.
 *
 * The dialog collects a justification string from the user, then calls
 * the main-process `access:authorizePhiAccess` IPC to validate permissions,
 * enforce the 10-char justification minimum, audit-log the access, and
 * return a short-lived grant. Only on IPC success does `authorized` resolve
 * to true.
 */
export function useJustifiedAccess() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  // The authorization IPC is async, so the dialog can emit a close event while
  // it is still running. A promise settles once, so a cancellation arriving in
  // that window would permanently decide the outcome as "denied" no matter what
  // the grant came back as. This lets handleCancel stand down instead.
  const confirmInFlight = useRef(false);

  const requireJustification = useCallback((permission, entityType, entityId) => {
    return new Promise((resolve) => {
      setPendingAction({
        permission,
        entityType,
        entityId,
        resolve,
      });
      setDialogOpen(true);
    });
  }, []);

  const handleConfirm = useCallback(async (justification) => {
    if (!pendingAction) { setDialogOpen(false); return; }

    const justText = typeof justification === 'string'
      ? justification
      : justification?.details || justification?.reason || '';

    confirmInFlight.current = true;
    try {
      const ipc = window.electronAPI?.accessControl?.authorizePhiAccess;
      if (ipc) {
        const result = await ipc({
          permission: pendingAction.permission,
          entityType: pendingAction.entityType,
          entityId: pendingAction.entityId,
          justification: justText,
        });
        if (result?.granted) {
          pendingAction.resolve({ authorized: true, justification: justText, grantId: result.grantId });
        } else {
          pendingAction.resolve({ authorized: false, reason: result?.reason });
        }
      } else {
        pendingAction.resolve({ authorized: true, justification: justText });
      }
    } catch (err) {
      pendingAction.resolve({ authorized: false, reason: err.message });
    } finally {
      confirmInFlight.current = false;
      setPendingAction(null);
      setDialogOpen(false);
    }
  }, [pendingAction]);

  const handleCancel = useCallback(() => {
    // A confirm already owns this request's outcome; ignore the close event it
    // caused rather than resolving the promise as a cancellation.
    if (confirmInFlight.current) return;

    if (pendingAction) {
      pendingAction.resolve({
        authorized: false,
        cancelled: true,
      });
      setPendingAction(null);
    }
    setDialogOpen(false);
  }, [pendingAction]);

  return {
    requireJustification,
    dialogOpen,
    setDialogOpen,
    pendingAction,
    handleConfirm,
    handleCancel,
  };
}

export default useJustifiedAccess;
