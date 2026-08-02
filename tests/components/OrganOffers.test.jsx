/**
 * src/pages/OrganOffers.jsx — the operational state machine for offers the
 * centre receives.
 *
 * Excluded from coverage as "covered by Playwright" (finding H-8); no e2e spec
 * navigates here. The rules worth pinning are the ones a coordinator cannot
 * recover from: an offer must not be transitioned into a status the state
 * machine forbids, a decline must carry an OPTN reason code (and free text when
 * the code is "other"), and the append-only history must not be fetched — and
 * therefore not audit-logged as a PHI read — until someone actually opens it.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { organOffers, entities } = vi.hoisted(() => ({
  organOffers: {
    list: vi.fn(),
    getDeclineReasons: vi.fn(),
    getEvents: vi.fn(),
    create: vi.fn(),
    transition: vi.fn(),
    expireDue: vi.fn(),
  },
  entities: {
    Patient: { list: vi.fn() },
    DonorOrgan: { list: vi.fn() },
  },
}));

vi.mock('@/api/apiClient', () => ({ api: { organOffers, entities } }));

import OrganOffers from '@/pages/OrganOffers';

/**
 * Radix marks the body `pointer-events: none` while a modal is open and relies
 * on the portal to restore it; jsdom has no layout, so user-event's
 * pointer-events guard would reject every click inside a dialog.
 */
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const PENDING_OFFER = {
  id: 'offer-1234-5678',
  status: 'PENDING',
  donor_organ_id: 'donor-abcdefgh',
  patient_id: 'patient-ijklmnop',
  rank: 3,
  offered_at: '2026-08-01T10:00:00Z',
  response_due_at: '2026-08-01T11:00:00Z',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrganOffers />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  organOffers.list.mockResolvedValue([]);
  organOffers.getDeclineReasons.mockResolvedValue({ 830: 'Donor age or quality', 799: 'Other, specify' });
  organOffers.getEvents.mockResolvedValue([]);
  entities.Patient.list.mockResolvedValue([]);
  entities.DonorOrgan.list.mockResolvedValue([]);
});

describe('OrganOffers list', () => {
  it('states that allocation stays in OPTN/UNet', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Organ Offers/i })).toBeInTheDocument();
    // This disclaimer is the boundary between an operational tracker and an
    // allocation system; it must not silently disappear.
    expect(screen.getByText(/Allocation remains in OPTN\/UNet/i)).toBeInTheDocument();
  });

  it('shows an empty state rather than an empty table', async () => {
    renderPage();
    expect(await screen.findByText(/No offers yet for this filter/i)).toBeInTheDocument();
  });

  it('shows the fetch error instead of an empty list', async () => {
    organOffers.list.mockRejectedValue(new Error('offer store unavailable'));
    renderPage();
    expect(await screen.findByText('offer store unavailable')).toBeInTheDocument();
  });

  it('shows a loading state while offers are in flight', async () => {
    organOffers.list.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText(/Loading offers/i)).toBeInTheDocument();
  });

  it('renders an offer row with its status, ids, rank and deadlines', async () => {
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    renderPage();
    const row = (await screen.findByText('donor-ab')).closest('tr');
    expect(within(row).getByText('PENDING')).toBeInTheDocument();
    expect(within(row).getByText('patient-')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('2026-08-01T10:00:00Z')).toBeInTheDocument();
    expect(within(row).getByText('2026-08-01T11:00:00Z')).toBeInTheDocument();
  });

  it('marks a missing rank and response deadline rather than rendering blanks', async () => {
    organOffers.list.mockResolvedValue([{ ...PENDING_OFFER, rank: null, response_due_at: null }]);
    renderPage();
    const row = (await screen.findByText('donor-ab')).closest('tr');
    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  it('counts offers by status', async () => {
    organOffers.list.mockResolvedValue([
      PENDING_OFFER,
      { ...PENDING_OFFER, id: 'o2' },
      { ...PENDING_OFFER, id: 'o3', status: 'DECLINED' },
    ]);
    renderPage();
    await screen.findAllByText('donor-ab');
    const pendingLabel = screen.getByText('PENDING', { selector: 'span' });
    expect(pendingLabel.parentElement.textContent).toBe('PENDING2');
    const declinedLabel = screen.getByText('DECLINED', { selector: 'span' });
    expect(declinedLabel.parentElement.textContent).toBe('DECLINED1');
    // A status with no offers reads as 0, not blank.
    expect(screen.getByText('EXPIRED', { selector: 'span' }).parentElement.textContent).toBe('EXPIRED0');
  });

  it('asks the store for one status when a filter tab is chosen', async () => {
    const user = setupUser();
    renderPage();
    await waitFor(() => expect(organOffers.list).toHaveBeenCalledWith({}));
    await user.click(screen.getByRole('tab', { name: /^Pending$/i }));
    await waitFor(() => expect(organOffers.list).toHaveBeenCalledWith({ status: 'PENDING' }));
  });

  it('re-reads the list on refresh', async () => {
    const user = setupUser();
    renderPage();
    await screen.findByText(/No offers yet/i);
    const before = organOffers.list.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(organOffers.list.mock.calls.length).toBeGreaterThan(before));
  });

  it('runs the expiry sweep and reports how many offers lapsed', async () => {
    const user = setupUser();
    organOffers.expireDue.mockResolvedValue({ expiredCount: 2 });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Expire due/i }));
    await waitFor(() => expect(organOffers.expireDue).toHaveBeenCalled());
  });

  it('reports a failed expiry sweep', async () => {
    const user = setupUser();
    organOffers.expireDue.mockRejectedValue(new Error('sweep failed'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Expire due/i }));
    await waitFor(() => expect(organOffers.expireDue).toHaveBeenCalled());
  });
});

describe('recording a new offer', () => {
  beforeEach(() => {
    entities.Patient.list.mockResolvedValue([
      { id: 'p1', first_name: 'Ada', last_name: 'Lovelace', patient_id: 'MRN-1' },
      { id: 'p2', first_name: 'Grace', last_name: 'Hopper', patient_id: null },
    ]);
    entities.DonorOrgan.list.mockResolvedValue([
      { id: 'd1-abcdefgh', donor_id: 'DON-1', organ_type: 'kidney', blood_type: 'O+' },
      { id: 'd2-abcdefgh' },
    ]);
  });

  async function openDialog() {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /New Offer/i }));
    await screen.findByRole('dialog');
    return user;
  }

  it('requires both a donor organ and a recipient', async () => {
    await openDialog();
    expect(screen.getByRole('button', { name: /Create offer/i })).toBeDisabled();
    expect(screen.getByText(/records the operational coordination/i)).toBeInTheDocument();
  });

  it('lists selectable donors and patients, labelling incomplete records', async () => {
    const user = await openDialog();
    await user.click(screen.getByText('Select donor organ'));
    expect(await screen.findByRole('option', { name: /DON-1 · kidney · O\+/ })).toBeInTheDocument();
    // A donor record with no id/organ/blood type must still be selectable and
    // visibly incomplete rather than rendering as an empty row.
    expect(screen.getByRole('option', { name: /organ\? · BT\?/ })).toBeInTheDocument();
  });

  it('creates the offer with numbers coerced and blank optional fields omitted', async () => {
    organOffers.create.mockResolvedValue({ id: 'new-offer', status: 'PENDING' });
    const user = await openDialog();

    await user.click(screen.getByText('Select donor organ'));
    await user.click(await screen.findByRole('option', { name: /DON-1/ }));
    await user.click(screen.getByText('Select patient'));
    await user.click(await screen.findByRole('option', { name: /Lovelace, Ada/ }));

    const dialog = screen.getByRole('dialog');
    const [rank] = within(dialog).getAllByRole('spinbutton');
    await user.type(rank, '2');
    await user.click(within(dialog).getByRole('button', { name: /Create offer/i }));

    await waitFor(() =>
      expect(organOffers.create).toHaveBeenCalledWith({
        donor_organ_id: 'd1-abcdefgh',
        patient_id: 'p1',
        rank: 2,
        response_due_at: undefined,
        backup_chain_position: undefined,
        notes: undefined,
      })
    );
    // The dialog closes on success so the coordinator cannot double-submit.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends the optional coordination fields when supplied', async () => {
    organOffers.create.mockResolvedValue({ id: 'new-offer', status: 'PENDING' });
    const user = await openDialog();

    await user.click(screen.getByText('Select donor organ'));
    await user.click(await screen.findByRole('option', { name: /DON-1/ }));
    await user.click(screen.getByText('Select patient'));
    await user.click(await screen.findByRole('option', { name: /Hopper, Grace/ }));

    const dialog = screen.getByRole('dialog');
    const [, backupPosition] = within(dialog).getAllByRole('spinbutton');
    await user.type(backupPosition, '1');
    await user.type(within(dialog).getByRole('textbox'), 'Backup after primary centre');
    await user.click(within(dialog).getByRole('button', { name: /Create offer/i }));

    await waitFor(() =>
      expect(organOffers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patient_id: 'p2',
          backup_chain_position: 1,
          notes: 'Backup after primary centre',
        })
      )
    );
  });

  it('keeps the dialog open when the store rejects the offer', async () => {
    organOffers.create.mockRejectedValue(new Error('donor organ already allocated'));
    const user = await openDialog();
    await user.click(screen.getByText('Select donor organ'));
    await user.click(await screen.findByRole('option', { name: /DON-1/ }));
    await user.click(screen.getByText('Select patient'));
    await user.click(await screen.findByRole('option', { name: /Lovelace, Ada/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Create offer/i }));

    await waitFor(() => expect(organOffers.create).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('discards the draft on cancel', async () => {
    const user = await openDialog();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(organOffers.create).not.toHaveBeenCalled();
  });
});

describe('transitioning an offer', () => {
  it('offers no transition for a terminal status', async () => {
    organOffers.list.mockResolvedValue([
      { ...PENDING_OFFER, id: 'o-final', status: 'ACCEPTED_FINAL' },
      { ...PENDING_OFFER, id: 'o-declined', status: 'DECLINED' },
      { ...PENDING_OFFER, id: 'o-expired', status: 'EXPIRED' },
      { ...PENDING_OFFER, id: 'o-rescinded', status: 'RESCINDED' },
    ]);
    renderPage();
    await screen.findAllByText('donor-ab');
    // Four rows, none of them transitionable.
    expect(screen.queryByRole('button', { name: /Transition/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /History/i })).toHaveLength(4);
  });

  it('only offers the statuses the state machine allows from PENDING', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));

    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['ACCEPTED_PROVISIONAL', 'ACCEPTED_FINAL', 'DECLINED', 'RESCINDED']);
    // PENDING is not a legal destination from PENDING, and EXPIRED is set only
    // by the server-side sweep.
    expect(options).not.toContain('PENDING');
    expect(options).not.toContain('EXPIRED');
  });

  it('narrows the allowed statuses once provisionally accepted', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([{ ...PENDING_OFFER, status: 'ACCEPTED_PROVISIONAL' }]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['ACCEPTED_FINAL', 'DECLINED', 'RESCINDED']);
  });

  it('records an acceptance with optional notes', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.transition.mockResolvedValue({ id: PENDING_OFFER.id, status: 'ACCEPTED_FINAL' });
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    await user.click(await screen.findByRole('option', { name: 'ACCEPTED_FINAL' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Surgeon confirmed');
    await user.click(within(dialog).getByRole('button', { name: /Save transition/i }));

    await waitFor(() =>
      expect(organOffers.transition).toHaveBeenCalledWith({
        id: PENDING_OFFER.id,
        to_status: 'ACCEPTED_FINAL',
        decline_reason_code: undefined,
        decline_reason_text: undefined,
        notes: 'Surgeon confirmed',
      })
    );
  });

  it('will not save a decline without an OPTN reason code', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    await user.click(await screen.findByRole('option', { name: 'DECLINED' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Decline reason code/i)).toBeInTheDocument();
    // A declined offer with no coded reason is not reportable to OPTN.
    expect(within(dialog).getByRole('button', { name: /Save transition/i })).toBeDisabled();
  });

  it('records a coded decline', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.transition.mockResolvedValue({});
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    await user.click(await screen.findByRole('option', { name: 'DECLINED' }));
    await user.click(await screen.findByText('Choose reason code'));
    await user.click(await screen.findByRole('option', { name: /830 — Donor age or quality/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Save transition/i }));

    await waitFor(() =>
      expect(organOffers.transition).toHaveBeenCalledWith({
        id: PENDING_OFFER.id,
        to_status: 'DECLINED',
        decline_reason_code: '830',
        decline_reason_text: undefined,
        notes: undefined,
      })
    );
  });

  it('requires free text for reason code 799 ("other")', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.transition.mockResolvedValue({});
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    await user.click(await screen.findByRole('option', { name: 'DECLINED' }));
    await user.click(await screen.findByText('Choose reason code'));
    await user.click(await screen.findByRole('option', { name: /799 — Other/ }));

    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /Save transition/i });
    expect(save).toBeDisabled();

    // Two free-text areas once "other" is chosen: the required reason, then notes.
    const [reason] = within(dialog).getAllByRole('textbox');
    await user.type(reason, 'Recipient became unfit');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(organOffers.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          decline_reason_code: '799',
          decline_reason_text: 'Recipient became unfit',
        })
      )
    );
  });

  it('keeps the dialog open when the transition is rejected by the state machine', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.transition.mockRejectedValue(new Error('illegal transition'));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(await screen.findByText('Select new status'));
    await user.click(await screen.findByRole('option', { name: 'RESCINDED' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Save transition/i }));

    await waitFor(() => expect(organOffers.transition).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('abandons the transition on cancel', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Transition/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(organOffers.transition).not.toHaveBeenCalled();
  });
});

describe('offer history', () => {
  it('does not read the audit trail until it is opened', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    renderPage();
    await screen.findByRole('button', { name: /History/i });
    // Reading an offer's history is itself an audited access; it must not happen
    // just because the row rendered.
    expect(organOffers.getEvents).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /History/i }));
    await waitFor(() => expect(organOffers.getEvents).toHaveBeenCalledWith(PENDING_OFFER.id));
  });

  it('renders each recorded event with actor and status change', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.getEvents.mockResolvedValue([
      {
        id: 'e1',
        created_at: '2026-08-01T10:00:00Z',
        event_type: 'OFFER_CREATED',
        from_status: null,
        to_status: 'PENDING',
        actor: 'coordinator@transtrack.local',
        payload: '{"rank":3}',
      },
      { id: 'e2', created_at: '2026-08-01T10:30:00Z', event_type: 'SWEEP', from_status: 'PENDING', to_status: 'EXPIRED' },
    ]);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /History/i }));
    expect(await screen.findByText('OFFER_CREATED')).toBeInTheDocument();
    expect(screen.getByText('coordinator@transtrack.local')).toBeInTheDocument();
    expect(screen.getByText('{"rank":3}')).toBeInTheDocument();
    // An event with no recorded actor is attributed to the system, not blank.
    expect(screen.getByText('system')).toBeInTheDocument();
  });

  it('shows a loading state while the history is being read', async () => {
    const user = setupUser();
    organOffers.list.mockResolvedValue([PENDING_OFFER]);
    organOffers.getEvents.mockReturnValue(new Promise(() => {}));
    renderPage();
    await user.click(await screen.findByRole('button', { name: /History/i }));
    expect(await screen.findByText(/Loading…/)).toBeInTheDocument();
  });
});
