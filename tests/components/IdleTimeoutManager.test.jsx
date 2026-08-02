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
 * Writing that test found the third failure mode for real: the warning dialog
 * was mounted and immediately torn down again, and the auto-logoff timer was
 * re-armed instead of firing, so automatic logoff never happened. The component
 * has been fixed; see the block at the bottom of this file for the root cause
 * and the assertions that now guard it.
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
 * The warning dialog and the sequential auto-logoff.
 *
 * These cases were written against a real defect and pinned with `it.fails`
 * while the component was out of scope. The component has since been fixed and
 * they are now live assertions.
 *
 * The defect: `handleActivity` listed `showWarning` in its dependency array and
 * the effect registering the activity listeners listed `handleActivity`. When
 * the warning timer set `showWarning` to true, `handleActivity` was recreated,
 * the effect tore down and re-ran, and its re-run called `resetTimers()` —
 * clearing the warning and re-arming both timers from that moment. The dialog
 * mounted for a single commit and the idle-logoff timer was re-armed every 13
 * minutes, so automatic logoff never fired at all. An unattended workstation
 * kept the last-rendered chart on screen indefinitely and never returned to the
 * login view, defeating HIPAA §164.312(a)(2)(iii).
 *
 * The fix reads every value the timer logic needs through a ref and narrows the
 * effect's dependencies to `isAuthenticated`, so raising the warning can no
 * longer re-run the effect. State is write-only from the timers' point of view.
 *
 * Note the deliberate use of two separate `advance()` calls below. A single
 * `advanceTimersByTime` spanning both deadlines runs the warning and logoff
 * timers in one flush, before React can process the state update — which is why
 * the original defect hid from a single-advance test. Splitting the advance is
 * what a real clock does and is what exercises the regression.
 */
describe('IdleTimeoutManager: warning window and sequential logoff', () => {
  it('keeps the warning on screen for the whole warning window', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    expect(screen.getByText(/Session Expiring Soon/i)).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
    expect(screen.getByText(/For HIPAA compliance/i)).toBeInTheDocument();
    advance(60 * 1000);
    expect(screen.getByText('1:00')).toBeInTheDocument();
  });

  it('logs out when the warning window elapses with no response', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    advance(WARNING_MS);
    expect(authState.logout).toHaveBeenCalledWith(true);
  });

  it('lets the user extend the session from the dialog', () => {
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

  it('lets the user log out immediately from the dialog', () => {
    render(<IdleTimeoutManager />);
    advance(IDLE_MS - WARNING_MS);
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Log Out Now/i })); });
    expect(authState.logout).toHaveBeenCalledWith(true);
  });
});
