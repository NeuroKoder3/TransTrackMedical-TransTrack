/**
 * src/components/session/IdleTimeoutManager.jsx — the automatic logoff that
 * keeps PHI off an unattended workstation (HIPAA §164.312(a)(2)(iii)).
 *
 * At 0% coverage before this file (finding H-8), and every failure mode of it is
 * silent: a timer that never fires leaves a chart on screen indefinitely, a
 * listener torn down on each render stops observing the OS lock, and an
 * over-eager reset means the session never expires at all. All of it is
 * timer-driven, so only a test with a controlled clock can observe it.
 *
 * Writing that test found the third failure mode for real. See the
 * "known defect" block at the bottom of this file: the warning dialog is
 * mounted and then immediately torn down again, and the auto-logoff timer is
 * re-armed instead of firing. The fix belongs in the component, which is
 * outside the scope of the change this file lands with, so the required
 * behaviour is pinned here with `it.fails` — those cases start failing (and so
 * demand attention) the moment the component is fixed.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const IDLE_MS = 15 * 60 * 1000;
const WARNING_MS = 2 * 60 * 1000;

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true, logout: null },
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

import IdleTimeoutManager from '@/components/session/IdleTimeoutManager';

const realElectronAPI = window.electronAPI;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
  authState.isAuthenticated = true;
  authState.logout = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  window.electronAPI = realElectronAPI;
});

/** Advance both the timer queue and Date.now(), which the component reads. */
function advance(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('IdleTimeoutManager', () => {
  it('renders nothing while no one is signed in, and arms no timers', () => {
    authState.isAuthenticated = false;
    const { container } = render(<IdleTimeoutManager />);
    expect(container).toBeEmptyDOMElement();
    advance(IDLE_MS * 2);
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('stays out of the way until the warning window opens', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS - 1000);
    expect(screen.queryByText(/Session Expiring Soon/i)).not.toBeInTheDocument();
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('logs off at the idle limit, and flags it as involuntary', () => {
    // logout(true) is the "involuntary" flag AuthContext uses to decide whether
    // to redirect and how to label the audit record. A false here would file an
    // idle timeout as a deliberate sign-out.
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS - 1000);
    expect(authState.logout).not.toHaveBeenCalled();
    // Crossing the warning boundary and the limit inside one advance, for the
    // reason given in the known-defect block at the bottom of this file.
    advance(WARNING_MS + 1000);
    expect(authState.logout).toHaveBeenCalledTimes(1);
    expect(authState.logout.mock.calls[0][0]).toBe(true);
  });

  it('treats a keystroke as activity and re-arms the idle limit from there', () => {
    render(<IdleTimeoutManager />);
    advance(10 * 60 * 1000);
    act(() => { fireEvent.keyDown(window, { key: 'a' }); });

    // Without the keystroke this would have logged out at 15 minutes.
    advance(5 * 60 * 1000);
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('ignores repeated mouse movement inside the throttle window', () => {
    render(<IdleTimeoutManager />);
    advance(10 * 1000);
    // Inside THROTTLE_MS (30s), so this must NOT push the deadline out; a mouse
    // resting on a jittery surface would otherwise hold a chart open all night.
    act(() => { fireEvent.mouseMove(window); });
    advance(IDLE_MS - 10 * 1000);
    expect(authState.logout).toHaveBeenCalledWith(true);
  });

  it('honours a click once past the throttle window', () => {
    render(<IdleTimeoutManager />);
    advance(31 * 1000);
    act(() => { fireEvent.mouseDown(window); });
    advance(IDLE_MS - 31 * 1000);
    // The deadline moved with the click, so the original one has passed with no
    // logout.
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it('does not log out a session that ended somewhere else', () => {
    const { rerender } = render(<IdleTimeoutManager />);
    advance(5 * 60 * 1000);

    authState.isAuthenticated = false;
    rerender(<IdleTimeoutManager />);

    advance(IDLE_MS * 2);
    // A second logout for an already-ended session would bounce a user who has
    // since signed in as somebody else.
    expect(authState.logout).not.toHaveBeenCalled();
    expect(screen.queryByText(/Session Expiring Soon/i)).not.toBeInTheDocument();
  });

  it('removes its activity listeners on unmount and fires nothing afterwards', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<IdleTimeoutManager />);
    unmount();
    for (const event of ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove']) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    }
    advance(IDLE_MS * 2);
    expect(authState.logout).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  describe('OS screen lock', () => {
    it('ends the session when the workstation locks', () => {
      let fire = null;
      const unsubscribe = vi.fn();
      const onLocked = vi.fn((cb) => { fire = cb; return unsubscribe; });
      window.electronAPI = { ...realElectronAPI, session: { onLocked } };

      const { unmount } = render(<IdleTimeoutManager />);
      advance(60 * 1000);

      act(() => { fire(); });
      expect(authState.logout).toHaveBeenCalledWith(true);
      expect(screen.queryByText(/Session Expiring Soon/i)).not.toBeInTheDocument();

      unmount();
      expect(unsubscribe).toHaveBeenCalled();
    });

    it('subscribes exactly once across re-renders', () => {
      const onLocked = vi.fn(() => vi.fn());
      window.electronAPI = { ...realElectronAPI, session: { onLocked } };
      const { rerender } = render(<IdleTimeoutManager />);
      rerender(<IdleTimeoutManager />);
      advance(IDLE_MS - WARNING_MS);
      rerender(<IdleTimeoutManager />);
      // Re-subscribing on every render would drop lock events during the churn.
      expect(onLocked).toHaveBeenCalledTimes(1);
    });

    it('runs without a session namespace on the bridge', () => {
      window.electronAPI = { ...realElectronAPI, session: undefined };
      expect(() => render(<IdleTimeoutManager />)).not.toThrow();
      advance(IDLE_MS);
      expect(authState.logout).toHaveBeenCalledWith(true);
    });
  });
});

describe('deployment-configured idle policy', () => {
  it('uses the timeouts the deploying site set in preload', async () => {
    // The constants are read at module load, so the policy has to be in place
    // before the module is imported.
    vi.resetModules();
    window.transtrackConfig = {
      ...window.transtrackConfig,
      securityPolicy: { IDLE_TIMEOUT_MS: 60_000, WARNING_BEFORE_MS: 20_000 },
    };
    const { default: Configured } = await import('@/components/session/IdleTimeoutManager');

    render(<Configured />);
    advance(39_000);
    expect(authState.logout).not.toHaveBeenCalled();
    advance(21_000);
    expect(authState.logout).toHaveBeenCalledWith(true);

    window.transtrackConfig = { apiBaseUrl: null };
    vi.resetModules();
  });
});

/**
 * KNOWN DEFECT — the warning dialog and the sequential auto-logoff.
 *
 * Root cause: `handleActivity` lists `showWarning` in its dependency array, and
 * the effect that registers the activity listeners lists `handleActivity`. When
 * the warning timer sets `showWarning` to true, `handleActivity` is recreated,
 * the effect tears down and re-runs, and its re-run calls `resetTimers()` —
 * which sets `showWarning` back to false and re-arms both timers from now. So:
 *
 *   • the dialog mounts for a single commit and is removed again, and
 *   • the 15-minute logoff timer is re-armed every 13 minutes and never fires.
 *
 * Measured with real timers against a 400ms/250ms policy: the dialog is present
 * in one 50ms sample and gone in every later one, and `logout` is still
 * uncalled 1.1s in — nearly three idle periods.
 *
 * The `it('arms the logoff timer at the idle limit')` case above passes because
 * a single `advanceTimersByTime` call runs the warning and logoff timers in the
 * same flush, before React can process the state update and re-run the effect.
 * Split the advance in two, as a real clock does, and it stops firing.
 *
 * Impact: an unattended workstation keeps the last-rendered chart on screen and
 * never returns to the login view. The main process is a partial backstop —
 * `validateSession` in electron/ipc/shared.cjs clears the session once
 * IDLE_TIMEOUT_MS has elapsed, so the next IPC call fails — but nothing wipes
 * the screen, and the user is never warned or given the chance to extend.
 *
 * The fix is in the component (read `showWarning` through a ref, or drop it
 * from the dependency array and re-register listeners only on auth changes).
 * src/** is out of scope for this change, so the required behaviour is pinned
 * with `it.fails`: each case asserts what the control is supposed to do and is
 * marked as currently failing. When the component is fixed these turn red, and
 * whoever fixes it removes the `.fails`.
 */
describe('IdleTimeoutManager: required behaviour, currently defective', () => {
  it.fails('keeps the warning on screen for the whole warning window', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    expect(screen.getByText(/Session Expiring Soon/i)).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    expect(screen.getByText(/For HIPAA compliance/i)).toBeInTheDocument();
    advance(60 * 1000);
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });

  it.fails('logs out when the warning window elapses with no response', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    advance(WARNING_MS);
    expect(authState.logout).toHaveBeenCalledWith(true);
  });

  it.fails('lets the user extend the session from the dialog', () => {
    const isAuthenticated = vi.fn().mockResolvedValue(true);
    window.electronAPI = { ...realElectronAPI, auth: { isAuthenticated } };
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);

    act(() => { fireEvent.click(screen.getByRole('button', { name: /Continue Session/i })); });
    expect(isAuthenticated).toHaveBeenCalled();
    advance(IDLE_MS - WARNING_MS - 1000);
    expect(screen.queryByText(/Session Expiring Soon/i)).not.toBeInTheDocument();
    expect(authState.logout).not.toHaveBeenCalled();
  });

  it.fails('lets the user log out immediately from the dialog', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Log Out Now/i })); });
    expect(authState.logout).toHaveBeenCalledWith(true);
  });
});
