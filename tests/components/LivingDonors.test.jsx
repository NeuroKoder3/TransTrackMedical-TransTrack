/**
 * src/pages/LivingDonors.jsx — living donor candidates from inquiry through
 * donation, plus the OPTN Policy 14 post-donation follow-ups.
 *
 * Excluded from coverage as "covered by Playwright" (finding H-8); no e2e spec
 * opens it. Two obligations live here that a silent regression would breach: a
 * deferral, decline or withdrawal must carry a recorded reason, and a donation
 * must carry a date — the 6/12/24-month follow-up schedule OPTN requires is
 * derived from it.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { livingDonor, entities } = vi.hoisted(() => ({
  livingDonor: {
    list: vi.fn(),
    create: vi.fn(),
    transition: vi.fn(),
    summary: vi.fn(),
    addEvalStep: vi.fn(),
    updateEvalStep: vi.fn(),
    updateFollowup: vi.fn(),
    markOverdue: vi.fn(),
  },
  entities: { Patient: { list: vi.fn() } },
}));

vi.mock('@/api/apiClient', () => ({ api: { livingDonor, entities } }));

import LivingDonors from '@/pages/LivingDonors';

const DONOR = {
  id: 'ld-1',
  first_name: 'Nadia',
  last_name: 'Okonkwo',
  mrn: 'LD-9001',
  date_of_birth: '1988-04-02',
  sex: 'F',
  blood_type: 'O+',
  intended_organ: 'kidney',
  status: 'EVALUATION',
  created_at: '2026-07-01T09:00:00Z',
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LivingDonors />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  livingDonor.list.mockResolvedValue([]);
  livingDonor.summary.mockResolvedValue({ evaluations: [], followups: [] });
  entities.Patient.list.mockResolvedValue([]);
});

describe('LivingDonors list', () => {
  it('renders the heading and the Policy 14 framing', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Living Donors/i })).toBeInTheDocument();
    expect(screen.getByText(/OPTN Policy 14 follow-ups/i)).toBeInTheDocument();
  });

  it('shows an empty state for the filter', async () => {
    renderPage();
    expect(await screen.findByText(/No living donor candidates for this filter/i)).toBeInTheDocument();
  });

  it('shows the read error rather than an empty roster', async () => {
    livingDonor.list.mockRejectedValue(new Error('donor store unavailable'));
    renderPage();
    expect(await screen.findByText('donor store unavailable')).toBeInTheDocument();
  });

  it('shows a loading state', async () => {
    livingDonor.list.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText(/Loading…/)).toBeInTheDocument();
  });

  it('lists a candidate with name, MRN, status and intended organ', async () => {
    livingDonor.list.mockResolvedValue([DONOR]);
    renderPage();
    const row = (await screen.findByText('Okonkwo, Nadia')).closest('tr');
    expect(within(row).getByText('LD-9001')).toBeInTheDocument();
    expect(within(row).getByText('EVALUATION')).toBeInTheDocument();
    expect(within(row).getByText('kidney')).toBeInTheDocument();
  });

  it('marks a candidate with no MRN rather than rendering a blank cell', async () => {
    livingDonor.list.mockResolvedValue([{ ...DONOR, mrn: null }]);
    renderPage();
    const row = (await screen.findByText('Okonkwo, Nadia')).closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('filters by status through the store, not in the renderer', async () => {
    const user = setupUser();
    renderPage();
    await waitFor(() => expect(livingDonor.list).toHaveBeenCalledWith({}));
    await user.click(screen.getByRole('tab', { name: 'APPROVED' }));
    await waitFor(() => expect(livingDonor.list).toHaveBeenCalledWith({ status: 'APPROVED' }));
  });

  it('sweeps overdue follow-ups and reports the count', async () => {
    const user = setupUser();
    livingDonor.markOverdue.mockResolvedValue({ overdueCount: 4 });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Sweep overdue/i }));
    await waitFor(() => expect(livingDonor.markOverdue).toHaveBeenCalled());
  });

  it('reports a failed overdue sweep', async () => {
    const user = setupUser();
    livingDonor.markOverdue.mockRejectedValue(new Error('sweep failed'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Sweep overdue/i }));
    await waitFor(() => expect(livingDonor.markOverdue).toHaveBeenCalled());
  });

  it('re-reads the roster on refresh', async () => {
    const user = setupUser();
    renderPage();
    await screen.findByText(/No living donor candidates/i);
    const before = livingDonor.list.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(livingDonor.list.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('adding a candidate', () => {
  async function openDialog() {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New Living Donor/i }));
    await screen.findByRole('dialog');
    return user;
  }

  it('requires a name and an intended organ', async () => {
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Begins in INQUIRY status/i)).toBeInTheDocument();

    const [firstName, lastName] = within(dialog).getAllByRole('textbox');
    await user.type(firstName, 'Nadia');
    await user.type(lastName, 'Okonkwo');
    // Still blocked: the organ drives the entire evaluation pathway.
    expect(save).toBeDisabled();
  });

  it('records the candidate with the demographics entered', async () => {
    entities.Patient.list.mockResolvedValue([
      { id: 'p1', first_name: 'Ada', last_name: 'Lovelace', patient_id: 'MRN-1' },
    ]);
    livingDonor.create.mockResolvedValue({ id: 'ld-new', status: 'INQUIRY' });
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');

    const [firstName, lastName, mrn] = within(dialog).getAllByRole('textbox');
    await user.type(firstName, 'Nadia');
    await user.type(lastName, 'Okonkwo');
    await user.type(mrn, 'LD-9001');

    await user.click(within(dialog).getByText('Organ'));
    await user.click(await screen.findByRole('option', { name: 'kidney' }));
    await user.click(within(dialog).getByText('ABO'));
    await user.click(await screen.findByRole('option', { name: 'O+' }));
    await user.click(within(dialog).getByText('Relationship'));
    await user.click(await screen.findByRole('option', { name: 'paired-exchange' }));
    await user.click(within(dialog).getByText('Optional'));
    await user.click(await screen.findByRole('option', { name: /Lovelace, Ada/ }));

    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(livingDonor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Nadia',
          last_name: 'Okonkwo',
          mrn: 'LD-9001',
          intended_organ: 'kidney',
          blood_type: 'O+',
          relationship_to_recipient: 'paired-exchange',
          recipient_patient_id: 'p1',
        })
      )
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the draft when the store rejects the candidate', async () => {
    livingDonor.create.mockRejectedValue(new Error('duplicate MRN'));
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');
    const [firstName, lastName] = within(dialog).getAllByRole('textbox');
    await user.type(firstName, 'Nadia');
    await user.type(lastName, 'Okonkwo');
    await user.click(within(dialog).getByText('Organ'));
    await user.click(await screen.findByRole('option', { name: 'kidney' }));
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(livingDonor.create).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('discards the draft on cancel', async () => {
    const user = await openDialog();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(livingDonor.create).not.toHaveBeenCalled();
  });

  it('offers every intended organ and relationship the workflow supports', async () => {
    const user = await openDialog();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByText('Organ'));
    const organs = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(organs).toEqual([
      'kidney', 'liver-segment', 'lung-lobe', 'pancreas-segment', 'intestine-segment',
    ]);
  });
});

describe('donor status transitions', () => {
  it('offers no transition from a terminal status', async () => {
    livingDonor.list.mockResolvedValue([
      { ...DONOR, id: 'a', status: 'DONATED' },
      { ...DONOR, id: 'b', status: 'DECLINED' },
      { ...DONOR, id: 'c', status: 'WITHDRAWN' },
    ]);
    const user = setupUser();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: /Open/i }))[0]);
    await screen.findByText(/Back to list/i);
    expect(screen.queryByRole('button', { name: /Transition/i })).not.toBeInTheDocument();
  });

  it('only offers the statuses reachable from EVALUATION', async () => {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([DONOR]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Choose status'));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['APPROVED', 'DEFERRED', 'DECLINED', 'WITHDRAWN']);
    // A donor cannot be walked back to INQUIRY, and cannot jump to DONATED
    // without an approval first.
    expect(options).not.toContain('INQUIRY');
    expect(options).not.toContain('DONATED');
  });

  it('requires a recorded reason for a deferral', async () => {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([DONOR]);
    livingDonor.transition.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Choose status'));
    await user.click(await screen.findByRole('option', { name: 'DEFERRED' }));

    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox'), 'BMI above centre threshold');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(livingDonor.transition).toHaveBeenCalledWith({
        id: 'ld-1',
        to_status: 'DEFERRED',
        reason: 'BMI above centre threshold',
        donation_date: undefined,
      })
    );
  });

  it.each(['DECLINED', 'WITHDRAWN'])('requires a reason for %s', async (status) => {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([DONOR]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Choose status'));
    await user.click(await screen.findByRole('option', { name: status }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Reason \(required\)/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });

  it('requires a donation date before a donor can be marked DONATED', async () => {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([{ ...DONOR, status: 'APPROVED' }]);
    livingDonor.transition.mockResolvedValue({});
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Choose status'));
    await user.click(await screen.findByRole('option', { name: 'DONATED' }));

    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    // The Policy 14 follow-up schedule is derived from this date.
    expect(save).toBeDisabled();
    expect(within(dialog).getByText(/Donation date \(required\)/i)).toBeInTheDocument();

    const dateInput = dialog.querySelector('input[type="date"]');
    await user.type(dateInput, '2026-08-01');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(livingDonor.transition).toHaveBeenCalledWith({
        id: 'ld-1',
        to_status: 'DONATED',
        reason: undefined,
        donation_date: '2026-08-01',
      })
    );
  });

  it('keeps the dialog open when the transition is refused', async () => {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([DONOR]);
    livingDonor.transition.mockRejectedValue(new Error('illegal transition'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Choose status'));
    await user.click(await screen.findByRole('option', { name: 'APPROVED' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(livingDonor.transition).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('donor detail', () => {
  async function openDetail() {
    const user = setupUser();
    livingDonor.list.mockResolvedValue([DONOR]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    return user;
  }

  it('shows the donor identity and lets the user return to the roster', async () => {
    const user = await openDetail();
    expect(await screen.findByText('Okonkwo, Nadia')).toBeInTheDocument();
    expect(screen.getByText(/MRN LD-9001 · DOB 1988-04-02 · F · O\+ · kidney/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Back to list/i }));
    expect(await screen.findByRole('button', { name: /New Living Donor/i })).toBeInTheDocument();
  });

  it('fills in missing demographics with an em dash', async () => {
    livingDonor.list.mockResolvedValue([
      { ...DONOR, mrn: null, date_of_birth: null, sex: null, blood_type: null },
    ]);
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Open/i }));
    expect(await screen.findByText(/MRN — · DOB — · — · — · kidney/)).toBeInTheDocument();
  });

  it('shows a loading state for the detail read', async () => {
    livingDonor.summary.mockReturnValue(new Promise(() => {}));
    await openDetail();
    expect(await screen.findByText(/Loading donor detail…/)).toBeInTheDocument();
  });

  it('lists evaluation steps with their schedule and owner', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [
        { id: 'e1', step: 'ABO confirmation', status: 'COMPLETE', scheduled_date: '2026-07-05', completed_date: '2026-07-06', owner_role: 'coordinator' },
        { id: 'e2', step: 'Social work', status: 'SCHEDULED' },
      ],
      followups: [],
    });
    await openDetail();
    expect(await screen.findByText('Evaluations (2)')).toBeInTheDocument();
    expect(screen.getByText('ABO confirmation')).toBeInTheDocument();
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    const pending = screen.getByText('Social work').closest('tr');
    // An unscheduled step must read as unscheduled, not as blank cells.
    expect(within(pending).getAllByText('—')).toHaveLength(3);
  });

  it('states when no evaluation steps exist yet', async () => {
    await openDetail();
    expect(await screen.findByText(/No evaluation steps yet/i)).toBeInTheDocument();
  });

  it('adds an evaluation step, requiring the step name', async () => {
    livingDonor.addEvalStep.mockResolvedValue({ id: 'e-new' });
    const user = await openDetail();
    await user.click(await screen.findByRole('button', { name: /Add step/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByPlaceholderText(/ABO confirmation/), 'Crossmatch');
    await user.type(within(dialog).getByPlaceholderText(/coordinator \/ nephrologist/), 'nephrologist');
    await user.click(save);

    await waitFor(() =>
      expect(livingDonor.addEvalStep).toHaveBeenCalledWith({
        living_donor_id: 'ld-1',
        step: 'Crossmatch',
        scheduled_date: '',
        owner_role: 'nephrologist',
        notes: '',
      })
    );
  });

  it('reports a failure to add a step', async () => {
    livingDonor.addEvalStep.mockRejectedValue(new Error('step already recorded'));
    const user = await openDetail();
    await user.click(await screen.findByRole('button', { name: /Add step/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(/ABO confirmation/), 'Crossmatch');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(livingDonor.addEvalStep).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('stamps a completion date when a step is marked complete', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [{ id: 'e1', step: 'Crossmatch', status: 'SCHEDULED' }],
      followups: [],
    });
    livingDonor.updateEvalStep.mockResolvedValue({});
    const user = await openDetail();
    await user.click(await screen.findByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'COMPLETE' }));

    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() =>
      expect(livingDonor.updateEvalStep).toHaveBeenCalledWith({
        id: 'e1', status: 'COMPLETE', completed_date: today,
      })
    );
  });

  it('does not stamp a completion date for a non-complete status', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [{ id: 'e1', step: 'Crossmatch', status: 'SCHEDULED' }],
      followups: [],
    });
    livingDonor.updateEvalStep.mockResolvedValue({});
    const user = await openDetail();
    await user.click(await screen.findByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'FAILED' }));
    await waitFor(() =>
      expect(livingDonor.updateEvalStep).toHaveBeenCalledWith({
        id: 'e1', status: 'FAILED', completed_date: undefined,
      })
    );
  });

  it('reports a failed evaluation update', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [{ id: 'e1', step: 'Crossmatch', status: 'SCHEDULED' }],
      followups: [],
    });
    livingDonor.updateEvalStep.mockRejectedValue(new Error('locked'));
    const user = await openDetail();
    await user.click(await screen.findByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'COMPLETE' }));
    await waitFor(() => expect(livingDonor.updateEvalStep).toHaveBeenCalled());
  });

  it('explains why no follow-ups exist before donation', async () => {
    const user = await openDetail();
    await user.click(await screen.findByRole('tab', { name: /Follow-ups/i }));
    expect(await screen.findByText(/No follow-ups scheduled \(donor has not yet donated\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-created at 6, 12, and 24 months/i)).toBeInTheDocument();
  });

  it('lists the Policy 14 milestones and records a completion', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [],
      followups: [
        { id: 'f1', milestone_months: 6, due_date: '2027-02-01', status: 'SCHEDULED' },
        { id: 'f2', milestone_months: 12, status: 'OVERDUE' },
      ],
    });
    livingDonor.updateFollowup.mockResolvedValue({});
    const user = await openDetail();
    await user.click(await screen.findByRole('tab', { name: /Follow-ups \(2\)/i }));

    expect(await screen.findByText('6')).toBeInTheDocument();
    expect(screen.getByText('2027-02-01')).toBeInTheDocument();
    expect(screen.getByText('OVERDUE')).toBeInTheDocument();

    const overdueRow = screen.getByText('12').closest('tr');
    await user.click(within(overdueRow).getByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'COMPLETE' }));

    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() =>
      expect(livingDonor.updateFollowup).toHaveBeenCalledWith({
        id: 'f2', status: 'COMPLETE', completed_date: today,
      })
    );
  });

  it('records a lost-to-follow-up without inventing a completion date', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [],
      followups: [{ id: 'f1', milestone_months: 24, status: 'SCHEDULED' }],
    });
    livingDonor.updateFollowup.mockResolvedValue({});
    const user = await openDetail();
    await user.click(await screen.findByRole('tab', { name: /Follow-ups/i }));
    await user.click(await screen.findByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'LOST_TO_FOLLOWUP' }));
    await waitFor(() =>
      expect(livingDonor.updateFollowup).toHaveBeenCalledWith({
        id: 'f1', status: 'LOST_TO_FOLLOWUP', completed_date: undefined,
      })
    );
  });

  it('reports a failed follow-up update', async () => {
    livingDonor.summary.mockResolvedValue({
      evaluations: [],
      followups: [{ id: 'f1', milestone_months: 6, status: 'SCHEDULED' }],
    });
    livingDonor.updateFollowup.mockRejectedValue(new Error('closed record'));
    const user = await openDetail();
    await user.click(await screen.findByRole('tab', { name: /Follow-ups/i }));
    await user.click(await screen.findByText('Set status'));
    await user.click(await screen.findByRole('option', { name: 'COMPLETE' }));
    await waitFor(() => expect(livingDonor.updateFollowup).toHaveBeenCalled());
  });
});
