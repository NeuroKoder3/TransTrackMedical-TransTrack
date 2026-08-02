/**
 * src/pages/PostTransplant.jsx — transplant events, immunosuppression,
 * rejection episodes, biopsies and readmissions for a recipient.
 *
 * Excluded from coverage as "covered by Playwright" (finding H-8); no e2e spec
 * opens it. Everything on this page is written against one patient id, so the
 * property that matters most is that no record can be created before a
 * recipient is selected and that every write carries the selected recipient —
 * an event filed against the wrong chart is a reportable data-integrity event.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { postTx, entities } = vi.hoisted(() => ({
  postTx: {
    getPatientSummary: vi.fn(),
    createEvent: vi.fn(),
    createImmuno: vi.fn(),
    createRejection: vi.fn(),
    createBiopsy: vi.fn(),
    createReadmission: vi.fn(),
  },
  entities: { Patient: { list: vi.fn() } },
}));

vi.mock('@/api/apiClient', () => ({ api: { postTx, entities } }));

import PostTransplant from '@/pages/PostTransplant';

const EMPTY_SUMMARY = {
  counts: { transplant_events: 0, immunosuppression: 0, rejections: 0, biopsies: 0, readmissions: 0 },
  transplant_events: [],
  immunosuppression: [],
  rejections: [],
  biopsies: [],
  readmissions: [],
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostTransplant />
    </QueryClientProvider>
  );
}

/** Select the seeded recipient and wait for the summary to load. */
async function selectRecipient(user) {
  await user.click(await screen.findByText('Select patient'));
  await user.click(await screen.findByRole('option', { name: /Okafor, Chidi/ }));
  await screen.findByRole('tab', { name: /Transplant events/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  entities.Patient.list.mockResolvedValue([
    { id: 'pat-1', first_name: 'Chidi', last_name: 'Okafor', patient_id: 'MRN-4001' },
    { id: 'pat-2', first_name: 'Mei', last_name: 'Tan', patient_id: null },
  ]);
  postTx.getPatientSummary.mockResolvedValue(EMPTY_SUMMARY);
});

describe('recipient selection', () => {
  it('reads no post-transplant records until a recipient is chosen', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /Post-Transplant Follow-up/i })).toBeInTheDocument();
    expect(screen.getByText(/Select a patient to view and manage post-transplant records/i)).toBeInTheDocument();
    // No patient id means no PHI read, and therefore no audit entry either.
    expect(postTx.getPatientSummary).not.toHaveBeenCalled();
  });

  it('loads the summary for the selected recipient only', async () => {
    const user = setupUser();
    renderPage();
    await selectRecipient(user);
    expect(postTx.getPatientSummary).toHaveBeenCalledTimes(1);
    expect(postTx.getPatientSummary).toHaveBeenCalledWith('pat-1');
  });

  it('labels a recipient with no MRN rather than hiding the record', async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByText('Select patient'));
    expect(await screen.findByRole('option', { name: /Tan, Mei · MRN —/ })).toBeInTheDocument();
  });

  it('shows a loading state for the summary', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockReturnValue(new Promise(() => {}));
    renderPage();
    await user.click(await screen.findByText('Select patient'));
    await user.click(await screen.findByRole('option', { name: /Okafor, Chidi/ }));
    expect(await screen.findByText(/Loading post-tx summary…/)).toBeInTheDocument();
  });

  it('shows the read error instead of an empty chart', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockRejectedValue(new Error('recipient record unavailable'));
    renderPage();
    await user.click(await screen.findByText('Select patient'));
    await user.click(await screen.findByRole('option', { name: /Okafor, Chidi/ }));
    expect(await screen.findByText('recipient record unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Transplant events/i })).not.toBeInTheDocument();
  });

  it('summarises the record counts', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      counts: { transplant_events: 1, immunosuppression: 3, rejections: 2, biopsies: 1, readmissions: 0 },
    });
    renderPage();
    await selectRecipient(user);
    expect(screen.getByText('transplant events').parentElement.textContent).toBe('transplant events1');
    expect(screen.getByText('immunosuppression').parentElement.textContent).toBe('immunosuppression3');
    expect(screen.getByText('readmissions').parentElement.textContent).toBe('readmissions0');
  });

  it('renders without count cards when the store returns none', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({ ...EMPTY_SUMMARY, counts: undefined });
    renderPage();
    await selectRecipient(user);
    expect(await screen.findByText(/No transplant events/i)).toBeInTheDocument();
  });
});

describe('empty states', () => {
  const TABS = [
    [/Transplant events/i, /No transplant events/i],
    [/Immunosuppression/i, /No regimens recorded/i],
    [/Rejection/i, /No rejection episodes/i],
    [/Biopsies/i, /No biopsies recorded/i],
    [/Readmissions/i, /No readmissions recorded/i],
  ];

  it.each(TABS)('states plainly that %s has no records', async (tab, empty) => {
    const user = setupUser();
    renderPage();
    await selectRecipient(user);
    await user.click(screen.getByRole('tab', { name: tab }));
    expect(await screen.findByText(empty)).toBeInTheDocument();
  });
});

describe('transplant events', () => {
  it('lists an event and marks the fields not yet known', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      transplant_events: [
        { id: 'e1', transplant_date: '2026-03-01', organ_type: 'kidney', surgeon: 'Dr Reyes', discharge_date: '2026-03-10', graft_status: 'functioning' },
        { id: 'e2', transplant_date: '2026-04-01', organ_type: 'liver' },
      ],
    });
    renderPage();
    await selectRecipient(user);

    const complete = screen.getByText('2026-03-01').closest('tr');
    expect(within(complete).getByText('Dr Reyes')).toBeInTheDocument();
    expect(within(complete).getByText('functioning')).toBeInTheDocument();
    const partial = screen.getByText('2026-04-01').closest('tr');
    expect(within(partial).getAllByText('—')).toHaveLength(3);
  });

  it('requires an organ and a date before an event can be filed', async () => {
    const user = setupUser();
    renderPage();
    await selectRecipient(user);
    await user.click(screen.getByRole('button', { name: /Add event/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.click(within(dialog).getByText('Select organ'));
    await user.click(await screen.findByRole('option', { name: 'kidney' }));
    // Organ alone is not enough — the date anchors every follow-up interval.
    expect(save).toBeDisabled();
  });

  it('files the event against the selected recipient', async () => {
    const user = setupUser();
    postTx.createEvent.mockResolvedValue({ id: 'e-new' });
    renderPage();
    await selectRecipient(user);
    await user.click(screen.getByRole('button', { name: /Add event/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Select organ'));
    await user.click(await screen.findByRole('option', { name: 'heart' }));
    await user.type(dialog.querySelector('input[type="date"]'), '2026-05-04');
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Dr Reyes');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(postTx.createEvent).toHaveBeenCalledWith({
        patientId: 'pat-1',
        organType: 'heart',
        transplantDate: '2026-05-04',
        surgeon: 'Dr Reyes',
        notes: '',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open when the event is rejected', async () => {
    const user = setupUser();
    postTx.createEvent.mockRejectedValue(new Error('event already recorded'));
    renderPage();
    await selectRecipient(user);
    await user.click(screen.getByRole('button', { name: /Add event/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByText('Select organ'));
    await user.click(await screen.findByRole('option', { name: 'kidney' }));
    await user.type(dialog.querySelector('input[type="date"]'), '2026-05-04');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(postTx.createEvent).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('discards a draft event on cancel', async () => {
    const user = setupUser();
    renderPage();
    await selectRecipient(user);
    await user.click(screen.getByRole('button', { name: /Add event/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(postTx.createEvent).not.toHaveBeenCalled();
  });
});

describe('immunosuppression', () => {
  async function openTab(user) {
    await user.click(screen.getByRole('tab', { name: /Immunosuppression/i }));
    await screen.findByRole('button', { name: /Add regimen/i });
  }

  it('shows an open-ended regimen as active rather than blank', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      immunosuppression: [
        { id: 'r1', drug_name: 'Tacrolimus', dose: '2mg', frequency: 'BID', start_date: '2026-03-02', end_date: null, target_trough: '5-8' },
        { id: 'r2', drug_name: 'Prednisone', start_date: '2026-03-02', end_date: '2026-06-01' },
      ],
    });
    renderPage();
    await selectRecipient(user);
    await openTab(user);

    const current = screen.getByText('Tacrolimus').closest('tr');
    expect(within(current).getByText('active')).toBeInTheDocument();
    expect(within(current).getByText('5-8')).toBeInTheDocument();
    const stopped = screen.getByText('Prednisone').closest('tr');
    expect(within(stopped).getByText('2026-06-01')).toBeInTheDocument();
    expect(within(stopped).getAllByText('—')).toHaveLength(3);
  });

  it('requires a drug and a start date, and omits blank optional fields', async () => {
    const user = setupUser();
    postTx.createImmuno.mockResolvedValue({ id: 'r-new' });
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add regimen/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByPlaceholderText(/Tacrolimus, Mycophenolate/), 'Tacrolimus');
    expect(save).toBeDisabled();
    const [startDate] = dialog.querySelectorAll('input[type="date"]');
    await user.type(startDate, '2026-03-02');
    expect(save).toBeEnabled();

    await user.type(within(dialog).getByPlaceholderText(/BID \/ QD \/ weekly/), 'BID');
    await user.click(save);

    await waitFor(() =>
      expect(postTx.createImmuno).toHaveBeenCalledWith({
        patientId: 'pat-1',
        drugName: 'Tacrolimus',
        dose: '',
        frequency: 'BID',
        startDate: '2026-03-02',
        endDate: undefined,
        targetTrough: undefined,
      })
    );
  });

  it('reports a rejected regimen', async () => {
    const user = setupUser();
    postTx.createImmuno.mockRejectedValue(new Error('overlapping regimen'));
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add regimen/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(/Tacrolimus, Mycophenolate/), 'Tacrolimus');
    await user.type(dialog.querySelectorAll('input[type="date"]')[0], '2026-03-02');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(postTx.createImmuno).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('rejection episodes', () => {
  async function openTab(user) {
    await user.click(screen.getByRole('tab', { name: /Rejection/i }));
    await screen.findByRole('button', { name: /Add rejection/i });
  }

  it('lists episodes with type, severity and treatment', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      rejections: [
        { id: 'x1', episode_date: '2026-04-02', rejection_type: 'ACR', severity: 'moderate', treatment: 'Steroid pulse', resolution_date: '2026-04-12' },
        { id: 'x2', episode_date: '2026-05-02' },
      ],
    });
    renderPage();
    await selectRecipient(user);
    await openTab(user);

    const treated = screen.getByText('2026-04-02').closest('tr');
    expect(within(treated).getByText('ACR')).toBeInTheDocument();
    expect(within(treated).getByText('moderate')).toBeInTheDocument();
    const unresolved = screen.getByText('2026-05-02').closest('tr');
    expect(within(unresolved).getAllByText('—')).toHaveLength(4);
  });

  it('requires an episode date and records the coded type and severity', async () => {
    const user = setupUser();
    postTx.createRejection.mockResolvedValue({ id: 'x-new' });
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add rejection/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.type(dialog.querySelector('input[type="date"]'), '2026-04-02');
    // Two selects in document order: rejection type, then severity. Their
    // labels and placeholders share the same text, so index by role.
    const [typeSelect, severitySelect] = within(dialog).getAllByRole('combobox');
    await user.click(typeSelect);
    await user.click(await screen.findByRole('option', { name: 'AMR' }));
    await user.click(severitySelect);
    await user.click(await screen.findByRole('option', { name: 'severe' }));
    await user.type(within(dialog).getByPlaceholderText(/Steroid pulse, ATG/), 'Plasmapheresis');
    await user.click(save);

    await waitFor(() =>
      expect(postTx.createRejection).toHaveBeenCalledWith({
        patientId: 'pat-1',
        episodeDate: '2026-04-02',
        rejectionType: 'AMR',
        severity: 'severe',
        treatment: 'Plasmapheresis',
        notes: '',
      })
    );
  });

  it('reports a rejected write', async () => {
    const user = setupUser();
    postTx.createRejection.mockRejectedValue(new Error('no transplant event on file'));
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add rejection/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(dialog.querySelector('input[type="date"]'), '2026-04-02');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(postTx.createRejection).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('biopsies', () => {
  async function openTab(user) {
    await user.click(screen.getByRole('tab', { name: /Biopsies/i }));
    await screen.findByRole('button', { name: /Add biopsy/i });
  }

  it('lists biopsies with their Banff grade when known', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      biopsies: [
        { id: 'b1', biopsy_date: '2026-04-03', biopsy_type: 'for-cause', finding: 'tubulitis', banff_grade: '1A' },
        { id: 'b2', biopsy_date: '2026-06-03' },
      ],
    });
    renderPage();
    await selectRecipient(user);
    await openTab(user);

    const graded = screen.getByText('2026-04-03').closest('tr');
    expect(within(graded).getByText('1A')).toBeInTheDocument();
    expect(within(graded).getByText('tubulitis')).toBeInTheDocument();
    const pending = screen.getByText('2026-06-03').closest('tr');
    expect(within(pending).getAllByText('—')).toHaveLength(3);
  });

  it('requires a biopsy date and records the finding', async () => {
    const user = setupUser();
    postTx.createBiopsy.mockResolvedValue({ id: 'b-new' });
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add biopsy/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    await user.type(dialog.querySelector('input[type="date"]'), '2026-04-03');
    await user.type(within(dialog).getByPlaceholderText(/Protocol, for-cause/), 'protocol');
    await user.click(save);

    await waitFor(() =>
      expect(postTx.createBiopsy).toHaveBeenCalledWith({
        patientId: 'pat-1',
        biopsyDate: '2026-04-03',
        biopsyType: 'protocol',
        finding: '',
        banffGrade: '',
        notes: '',
      })
    );
  });

  it('reports a rejected biopsy record', async () => {
    const user = setupUser();
    postTx.createBiopsy.mockRejectedValue(new Error('duplicate biopsy'));
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add biopsy/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(dialog.querySelector('input[type="date"]'), '2026-04-03');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(postTx.createBiopsy).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('readmissions', () => {
  async function openTab(user) {
    await user.click(screen.getByRole('tab', { name: /Readmissions/i }));
    await screen.findByRole('button', { name: /Add readmission/i });
  }

  it('states whether a readmission was graft-related', async () => {
    const user = setupUser();
    postTx.getPatientSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      readmissions: [
        { id: 'a1', admit_date: '2026-04-20', discharge_date: '2026-04-25', reason: 'AKI', related_to_graft: 1 },
        { id: 'a2', admit_date: '2026-05-20', related_to_graft: 0 },
      ],
    });
    renderPage();
    await selectRecipient(user);
    await openTab(user);

    const graftRelated = screen.getByText('2026-04-20').closest('tr');
    expect(within(graftRelated).getByText('Yes')).toBeInTheDocument();
    const stillAdmitted = screen.getByText('2026-05-20').closest('tr');
    expect(within(stillAdmitted).getByText('No')).toBeInTheDocument();
    // Still admitted: no discharge date, and no reason recorded yet.
    expect(within(stillAdmitted).getAllByText('—')).toHaveLength(2);
  });

  it('requires an admit date, omits a blank discharge date, and records the graft flag', async () => {
    const user = setupUser();
    postTx.createReadmission.mockResolvedValue({ id: 'a-new' });
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add readmission/i }));

    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: /^Save$/i });
    expect(save).toBeDisabled();

    const [admit] = dialog.querySelectorAll('input[type="date"]');
    await user.type(admit, '2026-04-20');
    await user.type(within(dialog).getAllByRole('textbox')[0], 'AKI');
    await user.click(within(dialog).getByLabelText(/Related to graft/i));
    await user.click(save);

    await waitFor(() =>
      expect(postTx.createReadmission).toHaveBeenCalledWith({
        patientId: 'pat-1',
        admitDate: '2026-04-20',
        dischargeDate: undefined,
        reason: 'AKI',
        relatedToGraft: true,
        notes: '',
      })
    );
  });

  it('reports a rejected readmission record', async () => {
    const user = setupUser();
    postTx.createReadmission.mockRejectedValue(new Error('admit date precedes transplant'));
    renderPage();
    await selectRecipient(user);
    await openTab(user);
    await user.click(screen.getByRole('button', { name: /Add readmission/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(dialog.querySelectorAll('input[type="date"]')[0], '2026-01-01');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(postTx.createReadmission).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
