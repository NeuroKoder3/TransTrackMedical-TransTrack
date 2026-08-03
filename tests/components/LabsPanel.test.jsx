/**
 * src/components/labs/LabsPanel.jsx (and the badges in LabStatusBadge.jsx) —
 * the per-patient lab result panel.
 *
 * Both files were at 0% coverage (finding H-8). The panel carries an explicit
 * product constraint that is also a regulatory one: it tracks documentation
 * completeness and must not interpret results. "Not clinical" is a claim about
 * behaviour, so the tests below assert it — the only signals rendered are
 * CURRENT / EXPIRED / MISSING and the counts behind them, and a value is shown
 * exactly as recorded with no derived judgement attached to it.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { labsApi } = vi.hoisted(() => ({
  labsApi: {
    getByPatient: vi.fn(),
    getPatientStatus: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/api/localClient', () => ({ default: { labs: labsApi } }));

import LabsPanel from '@/components/labs/LabsPanel';

/** Radix menus set pointer-events: none on the body while open. */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: 0 });
}

function renderPanel(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LabsPanel patientId="p1" patientName="Alice Smith" {...props} />
    </QueryClientProvider>
  );
}

const CREATININE = {
  id: 'lab-1',
  test_code: 'CREAT',
  test_name: 'Creatinine',
  value: '1.4',
  units: 'mg/dL',
  reference_range: '0.6-1.3',
  collected_at: '2026-07-20T08:00:00.000Z',
  resulted_at: '2026-07-20T10:30:00.000Z',
  source: 'MANUAL',
};

const HEMOGLOBIN = {
  id: 'lab-2',
  test_code: 'HGB',
  test_name: 'Hemoglobin',
  value: '9.8',
  units: 'g/dL',
  collected_at: '2026-07-18T08:00:00.000Z',
  source: 'FHIR_IMPORT',
};

beforeEach(() => {
  vi.clearAllMocks();
  labsApi.getByPatient.mockResolvedValue([]);
  labsApi.getPatientStatus.mockResolvedValue({ current: 0, expired: 0, missing: 0 });
  labsApi.create.mockResolvedValue({ id: 'lab-new' });
  labsApi.update.mockResolvedValue({ id: 'lab-1' });
  labsApi.delete.mockResolvedValue({ success: true });
});

describe('LabsPanel', () => {
  it('shows a loading state while the labs are in flight', async () => {
    labsApi.getByPatient.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(await screen.findByText(/Loading labs/i)).toBeInTheDocument();
  });

  it('reports a load failure instead of an empty panel', async () => {
    labsApi.getByPatient.mockRejectedValue(new Error('database is locked'));
    renderPanel();
    // An empty panel would read as "this patient has no labs", which for a
    // documentation-completeness view is the opposite of the truth.
    expect(await screen.findByText(/Error loading labs: database is locked/i)).toBeInTheDocument();
    expect(screen.queryByText(/No lab results recorded/i)).not.toBeInTheDocument();
  });

  it('does not query until a patient is selected', async () => {
    renderPanel({ patientId: undefined });
    expect(await screen.findByText(/No lab results recorded/i)).toBeInTheDocument();
    expect(labsApi.getByPatient).not.toHaveBeenCalled();
    expect(labsApi.getPatientStatus).not.toHaveBeenCalled();
  });

  it('states that values are not interpreted', async () => {
    renderPanel();
    expect(await screen.findByText(/Documentation tracking only/i)).toBeInTheDocument();
    expect(screen.getByText(/does NOT\s+interpret values, color-code abnormal results, or provide clinical recommendations/i))
      .toBeInTheDocument();
  });

  it('shows the empty state with no labs on file', async () => {
    renderPanel();
    expect(await screen.findByText(/No lab results recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/No labs/i)).toBeInTheDocument();
  });

  it('renders a result exactly as recorded, with its units and reference range', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    labsApi.getPatientStatus.mockResolvedValue({
      current: 1,
      expired: 0,
      missing: 0,
      labs: [{ test_code: 'CREAT', status: 'CURRENT' }],
    });
    renderPanel();

    expect(await screen.findByText('Creatinine')).toBeInTheDocument();
    expect(screen.getByText('1.4')).toBeInTheDocument();
    expect(screen.getByText('mg/dL')).toBeInTheDocument();
    // The range is shown as reference text only — no verdict is derived from it.
    expect(screen.getByText('(ref: 0.6-1.3)')).toBeInTheDocument();
    expect(screen.getByText('CREAT')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('Collected: Jul 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('Resulted: Jul 20, 2026')).toBeInTheDocument();
    expect(screen.getByText('1 current')).toBeInTheDocument();
  });

  it('labels an imported result as imported', async () => {
    labsApi.getByPatient.mockResolvedValue([HEMOGLOBIN]);
    renderPanel();
    // Provenance matters: a value that arrived over an interface has not been
    // through the same review as one a coordinator typed.
    expect(await screen.findByText('FHIR')).toBeInTheDocument();
    expect(screen.queryByText('Resulted:')).not.toBeInTheDocument();
  });

  it('falls back to the raw string for an undated or malformed collection date', async () => {
    labsApi.getByPatient.mockResolvedValue([
      { ...CREATININE, collected_at: null, resulted_at: 'not-a-date' },
    ]);
    renderPanel();
    expect(await screen.findByText('Collected: —')).toBeInTheDocument();
    expect(screen.getByText('Resulted: not-a-date')).toBeInTheDocument();
  });

  it('summarises documentation gaps and names the missing labs', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    labsApi.getPatientStatus.mockResolvedValue({
      current: 1,
      expired: 2,
      missing: 3,
      missingLabs: [{ test_name: 'HLA Typing' }, { test_name: 'Hepatitis B Surface Ag' }],
      labs: [{ test_code: 'CREAT', status: 'EXPIRED', message: 'Collected 95 days ago (max 90)' }],
    });
    renderPanel();

    expect(await screen.findByText('Documentation Gaps')).toBeInTheDocument();
    expect(screen.getByText('3 required lab(s) not documented')).toBeInTheDocument();
    expect(screen.getByText('2 lab(s) exceed max age threshold')).toBeInTheDocument();
    expect(screen.getByText('HLA Typing')).toBeInTheDocument();
    expect(screen.getByText('Hepatitis B Surface Ag')).toBeInTheDocument();
    expect(screen.getByText('2 expired, 3 missing')).toBeInTheDocument();
    // The per-result signal and its explanation, which is an age statement and
    // not an interpretation of the value.
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Collected 95 days ago (max 90)')).toBeInTheDocument();
  });

  it('shows no gap summary when nothing is missing or expired', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    labsApi.getPatientStatus.mockResolvedValue({ current: 4, expired: 0, missing: 0 });
    renderPanel();

    await screen.findByText('Creatinine');
    expect(screen.queryByText('Documentation Gaps')).not.toBeInTheDocument();
    expect(screen.getByText('4 current')).toBeInTheDocument();
  });

  it('shows the latest result per test with earlier ones behind a disclosure', async () => {
    const older = { ...CREATININE, id: 'lab-0', value: '1.1', collected_at: '2026-05-01T08:00:00.000Z' };
    const oldest = { ...CREATININE, id: 'lab-00', value: '0.9', collected_at: '2026-02-01T08:00:00.000Z' };
    labsApi.getByPatient.mockResolvedValue([CREATININE, older, oldest]);
    const user = setupUser();
    renderPanel();

    expect(await screen.findByText('1.4')).toBeInTheDocument();
    expect(screen.queryByText('1.1')).not.toBeInTheDocument();
    expect(screen.getByText('2 previous result(s)')).toBeInTheDocument();

    await user.click(screen.getByText('2 previous result(s)'));
    expect(await screen.findByText('1.1')).toBeInTheDocument();
    expect(screen.getByText('0.9')).toBeInTheDocument();
    expect(screen.getByText('May 1, 2026')).toBeInTheDocument();
  });

  it('offers no filter for a single test type', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    renderPanel();
    await screen.findByText('Creatinine');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('filters the list down to one test type', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE, HEMOGLOBIN]);
    const user = setupUser();
    renderPanel();

    await screen.findByText('Creatinine');
    expect(screen.getByText('Hemoglobin')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['All Tests', 'CREAT', 'HGB']);

    await user.click(options.find((o) => o.textContent === 'HGB'));
    await waitFor(() => expect(screen.queryByText('Creatinine')).not.toBeInTheDocument());
    expect(screen.getByText('Hemoglobin')).toBeInTheDocument();
  });

  it('hides the add button when the host asks it to', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    renderPanel({ showAddButton: false });
    await screen.findByText('Creatinine');
    expect(screen.queryByRole('button', { name: /Add Lab/i })).not.toBeInTheDocument();
  });

  it('records a new lab through the form and returns to the list', async () => {
    const user = setupUser();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /Add Lab/i }));

    // LabForm has its own suite; here the contract that matters is that the
    // panel hands the form's payload to the create call and comes back.
    expect(await screen.findByText(/Add Lab Result|Record Lab/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(await screen.findByText(/No lab results recorded/i)).toBeInTheDocument();
    expect(labsApi.create).not.toHaveBeenCalled();
  });

  it('opens the form pre-filled when editing a result', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    const user = setupUser();
    renderPanel();

    await screen.findByText('Creatinine');
    await user.click(screen.getByTitle('Edit'));
    expect(await screen.findByDisplayValue('1.4')).toBeInTheDocument();
  });

  it('requires confirmation before deleting, and says the deletion is audited', async () => {
    labsApi.getByPatient.mockResolvedValue([CREATININE]);
    const user = setupUser();
    renderPanel();

    await screen.findByText('Creatinine');
    await user.click(screen.getByTitle('Delete'));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/recorded in the audit log/i)).toBeInTheDocument();
    expect(labsApi.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /^Cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(labsApi.delete).not.toHaveBeenCalled();

    await user.click(screen.getByTitle('Delete'));
    const reopened = await screen.findByRole('alertdialog');
    await user.click(within(reopened).getByRole('button', { name: /^Delete$/i }));
    await waitFor(() => expect(labsApi.delete).toHaveBeenCalledWith('lab-1'));
  });
});
