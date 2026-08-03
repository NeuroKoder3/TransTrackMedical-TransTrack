/**
 * src/components/barriers/ReadinessBarrierList.jsx (and the badges in
 * BarrierStatusBadge.jsx) — the per-patient readiness barrier list.
 *
 * Both were at 0% coverage (finding H-8). Barriers are the operational record of
 * why a patient is not ready, and they are explicitly non-clinical and
 * non-allocative; the list is where a coordinator sees what is open, what is
 * overdue, and who owns it. The regressions that matter here are quiet ones: an
 * overdue barrier that stops being flagged, a resolved barrier that keeps
 * showing as open, and a type or role code rendered raw because the lookup
 * failed — each of which puts the wrong picture of a patient in front of the
 * person acting on it.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { barriersApi } = vi.hoisted(() => ({
  barriersApi: {
    getTypes: vi.fn(),
    getOwningRoles: vi.fn(),
    getByPatient: vi.fn(),
    getPatientSummary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    resolve: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/api/localClient', () => ({ default: { barriers: barriersApi } }));

import ReadinessBarrierList from '@/components/barriers/ReadinessBarrierList';

function setupUser() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

function renderList(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReadinessBarrierList patientId="p1" patientName="Alice Smith" {...props} />
    </QueryClientProvider>
  );
}

const TYPES = {
  insurance_authorization: { label: 'Insurance Authorization' },
  dental_clearance: { label: 'Dental Clearance' },
};

const ROLES = {
  SOCIAL_WORK: { value: 'social_work', label: 'Social Work' },
  FINANCIAL: { value: 'financial_coordinator', label: 'Financial Coordinator' },
};

const OPEN_BARRIER = {
  id: 'b1',
  barrier_type: 'insurance_authorization',
  status: 'open',
  risk_level: 'high',
  owning_role: 'financial_coordinator',
  identified_date: '2026-07-01T00:00:00.000Z',
  target_resolution_date: '2026-12-31T00:00:00.000Z',
  notes: 'Payer requires a second appeal letter.',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
  barriersApi.getTypes.mockResolvedValue(TYPES);
  barriersApi.getOwningRoles.mockResolvedValue(ROLES);
  barriersApi.getByPatient.mockResolvedValue([]);
  barriersApi.getPatientSummary.mockResolvedValue({ totalOpen: 0, byRiskLevel: {} });
  barriersApi.resolve.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReadinessBarrierList', () => {
  it('shows a loading state while the barriers are in flight', async () => {
    barriersApi.getByPatient.mockReturnValue(new Promise(() => {}));
    renderList();
    expect(await screen.findByText(/Loading barriers/i)).toBeInTheDocument();
  });

  it('reports a load failure instead of an empty list', async () => {
    barriersApi.getByPatient.mockRejectedValue(new Error('database is locked'));
    renderList();
    expect(await screen.findByText(/Error loading barriers: database is locked/i)).toBeInTheDocument();
    // "No open barriers" here would say the patient is ready, which is the most
    // consequential thing this component could get wrong.
    expect(screen.queryByText(/No open readiness barriers/i)).not.toBeInTheDocument();
  });

  it('does not query until a patient is selected', async () => {
    renderList({ patientId: undefined });
    expect(await screen.findByText(/No open readiness barriers/i)).toBeInTheDocument();
    expect(barriersApi.getByPatient).not.toHaveBeenCalled();
    expect(barriersApi.getPatientSummary).not.toHaveBeenCalled();
  });

  it('states that the feature is non-clinical and non-allocative', async () => {
    renderList();
    expect(await screen.findByText(/Non-clinical operational tracking only/i)).toBeInTheDocument();
    expect(screen.getByText(/non-allocative, and does not replace UNOS\/OPTN systems/i)).toBeInTheDocument();
  });

  it('shows the clear state when nothing is open', async () => {
    renderList();
    expect(await screen.findByText(/No open readiness barriers/i)).toBeInTheDocument();
    expect(screen.getByText('No barriers')).toBeInTheDocument();
  });

  it('renders an open barrier with its type, owner, risk and dates resolved to labels', async () => {
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    barriersApi.getPatientSummary.mockResolvedValue({ totalOpen: 1, byRiskLevel: { high: 1 } });
    renderList();

    expect(await screen.findByText('Insurance Authorization')).toBeInTheDocument();
    expect(screen.getByText('Financial Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('High Risk')).toBeInTheDocument();
    expect(screen.getByText(/1 barrier\b/)).toBeInTheDocument();
    expect(screen.getByText(/Added:/)).toBeInTheDocument();
    expect(screen.getByText(/Target:/)).toBeInTheDocument();
    // Not past its target date yet.
    expect(screen.queryByText('OVERDUE')).not.toBeInTheDocument();
  });

  it('falls back to the raw code when a type or role is not in the lookup', async () => {
    // The lookups come from IPC. If one fails or a new code ships ahead of its
    // label, the code itself must still be visible rather than a blank cell.
    barriersApi.getTypes.mockResolvedValue({});
    barriersApi.getOwningRoles.mockResolvedValue({});
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();

    expect(await screen.findByText('insurance_authorization')).toBeInTheDocument();
    expect(screen.getByText('financial_coordinator')).toBeInTheDocument();
  });

  it('flags a barrier past its target resolution date as overdue', async () => {
    barriersApi.getByPatient.mockResolvedValue([
      { ...OPEN_BARRIER, target_resolution_date: '2026-07-15T00:00:00.000Z' },
    ]);
    renderList();
    expect(await screen.findByText('OVERDUE')).toBeInTheDocument();
  });

  it('does not call a barrier with no target date overdue', async () => {
    barriersApi.getByPatient.mockResolvedValue([
      { ...OPEN_BARRIER, target_resolution_date: null },
    ]);
    renderList();
    await screen.findByText('Insurance Authorization');
    expect(screen.queryByText('OVERDUE')).not.toBeInTheDocument();
    expect(screen.queryByText(/Target:/)).not.toBeInTheDocument();
  });

  it('shows an in-progress barrier as in progress', async () => {
    barriersApi.getByPatient.mockResolvedValue([
      { ...OPEN_BARRIER, status: 'in_progress', risk_level: 'moderate' },
    ]);
    renderList();
    expect(await screen.findByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('keeps notes behind a disclosure and toggles them', async () => {
    const user = setupUser();
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();

    await screen.findByText('Insurance Authorization');
    expect(screen.queryByText(/second appeal letter/i)).not.toBeInTheDocument();

    await user.click(screen.getByText('Notes'));
    expect(await screen.findByText(/second appeal letter/i)).toBeInTheDocument();

    await user.click(screen.getByText('Notes'));
    await waitFor(() => expect(screen.queryByText(/second appeal letter/i)).not.toBeInTheDocument());
  });

  it('offers no notes disclosure for a barrier without notes', async () => {
    barriersApi.getByPatient.mockResolvedValue([{ ...OPEN_BARRIER, notes: '' }]);
    renderList();
    await screen.findByText('Insurance Authorization');
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('resolves a barrier through the API rather than only in the view', async () => {
    const user = setupUser();
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();

    await screen.findByText('Insurance Authorization');
    await user.click(screen.getByTitle('Mark Resolved'));
    await waitFor(() => expect(barriersApi.resolve).toHaveBeenCalledWith('b1'));
  });

  it('separates resolved barriers behind a toggle and refetches with them included', async () => {
    const user = setupUser();
    barriersApi.getByPatient.mockResolvedValue([
      OPEN_BARRIER,
      {
        id: 'b2',
        barrier_type: 'dental_clearance',
        status: 'resolved',
        risk_level: 'low',
        owning_role: 'social_work',
        identified_date: '2026-06-01T00:00:00.000Z',
        resolved_date: '2026-07-10T00:00:00.000Z',
      },
    ]);
    renderList();

    // A resolved barrier is not an open one, so it is not in the active list.
    expect(await screen.findByText('Show Resolved (1)')).toBeInTheDocument();
    expect(screen.queryByText('Dental Clearance')).not.toBeInTheDocument();
    expect(barriersApi.getByPatient).toHaveBeenCalledWith('p1', false);

    await user.click(screen.getByRole('button', { name: /Show Resolved \(1\)/i }));

    expect(await screen.findByText('Dental Clearance')).toBeInTheDocument();
    expect(screen.getByText(/Resolved: /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide Resolved \(1\)/i })).toBeInTheDocument();
    // The resolved set is fetched from the database, not filtered client-side
    // from a list that never contained it.
    await waitFor(() => expect(barriersApi.getByPatient).toHaveBeenCalledWith('p1', true));
  });

  it('offers no resolved section when there are none', async () => {
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();
    await screen.findByText('Insurance Authorization');
    expect(screen.queryByText(/Show Resolved/i)).not.toBeInTheDocument();
  });

  it('hides the add button when the host asks it to', async () => {
    renderList({ showAddButton: false });
    await screen.findByText(/No open readiness barriers/i);
    expect(screen.queryByRole('button', { name: /Add Barrier/i })).not.toBeInTheDocument();
  });

  it('opens the form to add a barrier and returns on cancel', async () => {
    const user = setupUser();
    renderList();
    await user.click(await screen.findByRole('button', { name: /Add Barrier/i }));

    expect(await screen.findByText('Add Readiness Barrier')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(await screen.findByText(/No open readiness barriers/i)).toBeInTheDocument();
    expect(barriersApi.create).not.toHaveBeenCalled();
  });

  it('opens the form pre-filled when editing', async () => {
    const user = setupUser();
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();

    await screen.findByText('Insurance Authorization');
    await user.click(screen.getByTitle('Edit'));
    expect(await screen.findByDisplayValue(/second appeal letter/i)).toBeInTheDocument();
  });

  // Note for whoever next touches this component: the delete confirmation
  // dialog it renders is unreachable. Nothing in the tree calls
  // setDeleteConfirm, so `deleteConfirm` is always null, the dialog never
  // opens, and api.barriers.delete is dead code from the UI's point of view.
  // That is the safer of the two possible defects — resolving preserves the
  // audit trail and deleting does not — so it is recorded here rather than
  // worked around in a test.
  it('exposes no way to delete a barrier from the list', async () => {
    barriersApi.getByPatient.mockResolvedValue([OPEN_BARRIER]);
    renderList();
    await screen.findByText('Insurance Authorization');
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
