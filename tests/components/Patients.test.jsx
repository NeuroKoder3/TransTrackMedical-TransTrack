/**
 * src/pages/Patients.jsx — the patient roster: the list view, the create/edit
 * form host, and the CSV roster import.
 *
 * The import path was entirely uncovered (finding H-8) and is the highest-risk
 * code on this page: it writes patient records in bulk from a file chosen by the
 * user, one row at a time, and decides on its own which rows to skip. A silent
 * skip is a patient who is not on the waitlist and whom nobody is looking for,
 * so what these tests pin down is that every rejected row is reported, that a
 * partial import is reported as partial, and that a non-numeric score is never
 * coerced into a record.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

const { patientApi, filesApi, functionsApi, mockMe } = vi.hoisted(() => ({
  patientApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  filesApi: { importFile: vi.fn() },
  functionsApi: { invoke: vi.fn() },
  mockMe: vi.fn(),
}));

vi.mock('@/api/apiClient', () => ({
  api: {
    entities: {
      Patient: patientApi,
      AuditLog: { create: vi.fn().mockResolvedValue({ id: 'a1' }) },
    },
    auth: { me: mockMe },
    files: filesApi,
    functions: functionsApi,
  },
}));

import Patients from '@/pages/Patients';

function renderPatients() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <Patients />
      </HashRouter>
    </QueryClientProvider>
  );
}

/** The import summary and error banners are both role="alert". */
function alertText() {
  return screen.getAllByRole('alert').map((el) => el.textContent).join('\n');
}

const PATIENT = {
  id: 'p1',
  patient_id: 'MRN-001',
  first_name: 'Alice',
  last_name: 'Smith',
  blood_type: 'B+',
  organ_needed: 'liver',
  waitlist_status: 'active',
  priority_score: 65,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
  patientApi.list.mockResolvedValue([]);
  patientApi.create.mockResolvedValue({ id: 'p-new' });
  patientApi.update.mockResolvedValue({ id: 'p1' });
  functionsApi.invoke.mockResolvedValue({ success: true });
});

describe('Patients Page', () => {
  it('renders the page heading and subheading', async () => {
    renderPatients();
    expect(await screen.findByText('Patient Management')).toBeInTheDocument();
    expect(screen.getByText(/Add and manage patient records/i)).toBeInTheDocument();
  });

  it('offers Add Patient and Import CSV', async () => {
    renderPatients();
    expect(await screen.findByRole('button', { name: /Add Patient/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import CSV/i })).toBeInTheDocument();
  });

  it('shows empty state when no patients exist', async () => {
    renderPatients();
    expect(await screen.findByText(/No patients yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Add your first patient to get started/i)).toBeInTheDocument();
  });

  it('shows a loading state before the roster arrives', async () => {
    patientApi.list.mockReturnValue(new Promise(() => {}));
    renderPatients();
    expect(await screen.findByText(/Loading patients/i)).toBeInTheDocument();
    expect(screen.queryByText(/No patients yet/i)).not.toBeInTheDocument();
  });

  it('displays patient data in a table after loading', async () => {
    patientApi.list.mockResolvedValue([PATIENT]);
    renderPatients();
    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('MRN-001')).toBeInTheDocument();
    expect(screen.getByText('B+')).toBeInTheDocument();
    expect(screen.getByText('liver')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('65')).toBeInTheDocument();
    // Requests the most recent records first, and bounds the page size.
    expect(patientApi.list).toHaveBeenCalledWith('-created_at', 500);
  });

  it('renders a patient with no priority score as 0 rather than blank', async () => {
    patientApi.list.mockResolvedValue([{ ...PATIENT, priority_score: undefined }]);
    renderPatients();
    expect(await screen.findByText('0')).toBeInTheDocument();
  });

  it('reads underscored enum values as words', async () => {
    patientApi.list.mockResolvedValue([
      { ...PATIENT, organ_needed: 'kidney_pancreas', waitlist_status: 'temporarily_inactive' },
    ]);
    renderPatients();
    expect(await screen.findByText('kidney-pancreas')).toBeInTheDocument();
    expect(screen.getByText('temporarily inactive')).toBeInTheDocument();
  });

  it('reports a failed roster load instead of an empty roster', async () => {
    patientApi.list.mockRejectedValue(new Error('database is locked'));
    renderPatients();
    expect(await screen.findByText(/Failed to load patients/i)).toBeInTheDocument();
    // An empty-state message here would read as "this patient has no records",
    // which is the wrong clinical conclusion to invite.
    expect(screen.queryByText(/No patients yet/i)).not.toBeInTheDocument();
  });

  it('opens the form for a new patient and hides the toolbar', async () => {
    const user = userEvent.setup();
    renderPatients();
    await user.click(await screen.findByRole('button', { name: /Add Patient/i }));

    expect(await screen.findByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Waitlist Information')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import CSV/i })).not.toBeInTheDocument();
  });

  it('opens the form pre-filled when editing an existing patient', async () => {
    const user = userEvent.setup();
    patientApi.list.mockResolvedValue([PATIENT]);
    renderPatients();
    await user.click(await screen.findByRole('button', { name: /^Edit$/i }));

    expect(await screen.findByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MRN-001')).toBeInTheDocument();
  });

  it('returns to the roster on cancel', async () => {
    const user = userEvent.setup();
    patientApi.list.mockResolvedValue([PATIENT]);
    renderPatients();
    await user.click(await screen.findByRole('button', { name: /Add Patient/i }));
    await user.click(await screen.findByRole('button', { name: /Cancel/i }));

    expect(await screen.findByRole('button', { name: /Import CSV/i })).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });
});

describe('CSV roster import', () => {
  const ROW = {
    patient_id: 'MRN-100',
    first_name: 'Bob',
    last_name: 'Jones',
    blood_type: 'O+',
    organ_needed: 'kidney',
    meld_score: '22',
  };

  async function startImport(user) {
    await user.click(await screen.findByRole('button', { name: /Import CSV/i }));
  }

  it('does nothing when the file dialog is cancelled', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({ cancelled: true });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(filesApi.importFile).toHaveBeenCalledWith('csv'));
    expect(patientApi.create).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    // The button has to come back, or the page is stuck after a cancel.
    await waitFor(() => expect(screen.getByRole('button', { name: /Import CSV/i })).toBeEnabled());
  });

  it('does nothing when the bridge returns nothing at all', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue(null);
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(filesApi.importFile).toHaveBeenCalled());
    expect(patientApi.create).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('reports an unparseable file rather than importing zero rows quietly', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({ success: false, filename: 'roster.csv' });
    renderPatients();
    await startImport(user);

    expect(await screen.findByText(/the file could not be parsed/i)).toBeInTheDocument();
    expect(patientApi.create).not.toHaveBeenCalled();
  });

  it('treats a non-array payload as a parse failure', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({ success: true, data: { rows: [] }, filename: 'roster.csv' });
    renderPatients();
    await startImport(user);

    expect(await screen.findByText(/the file could not be parsed/i)).toBeInTheDocument();
    expect(patientApi.create).not.toHaveBeenCalled();
  });

  it('creates a record per row, trims values, converts scores and ignores unknown columns', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'roster.csv',
      data: [{
        ...ROW,
        first_name: '  Bob  ',
        pra_percentage: '15.5',
        cpra_percentage: '0',
        notes: '',
        unknown_column: 'ignored',
      }],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(patientApi.create).toHaveBeenCalledTimes(1));
    const payload = patientApi.create.mock.calls[0][0];
    expect(payload).toEqual({
      patient_id: 'MRN-100',
      first_name: 'Bob',
      last_name: 'Jones',
      blood_type: 'O+',
      organ_needed: 'kidney',
      meld_score: 22,
      pra_percentage: 15.5,
      cpra_percentage: 0,
    });
    // A blank cell must not overwrite a field with an empty string, and a column
    // the application does not know about must not reach the database.
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('unknown_column');
    expect(alertText()).toContain('Imported 1 patient from roster.csv');
  });

  it('recalculates priority for each imported patient', async () => {
    const user = userEvent.setup();
    patientApi.create.mockResolvedValue({ id: 'p-imported' });
    filesApi.importFile.mockResolvedValue({ success: true, filename: 'roster.csv', data: [ROW] });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(functionsApi.invoke).toHaveBeenCalledWith(
      'calculatePriorityAdvanced',
      { patient_id: 'p-imported' },
    ));
  });

  it('keeps the patient when the priority calculation fails', async () => {
    const user = userEvent.setup();
    functionsApi.invoke.mockRejectedValue(new Error('priority engine offline'));
    filesApi.importFile.mockResolvedValue({ success: true, filename: 'roster.csv', data: [ROW] });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Imported 1 patient from roster.csv'));
    expect(alertText()).not.toContain('skipped');
  });

  it('skips a row with no name and says which row it was', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'roster.csv',
      data: [{ ...ROW, last_name: '' }, ROW],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Imported 1 patient from roster.csv'));
    const text = alertText();
    // Row 2 of the file is the first data row, because row 1 is the header.
    expect(text).toContain('(1 row skipped)');
    expect(text).toContain('Row 2: first_name and last_name are required');
    expect(patientApi.create).toHaveBeenCalledTimes(1);
  });

  it('refuses to coerce a non-numeric score, and drops the row that needed it', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'roster.csv',
      data: [{ ...ROW, meld_score: 'twenty-two' }],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Row 2: meld_score must be a number (got "twenty-two")'));
    // The record is still created — with no MELD rather than a wrong one.
    expect(patientApi.create).toHaveBeenCalledTimes(1);
    expect(patientApi.create.mock.calls[0][0]).not.toHaveProperty('meld_score');
  });

  it('reports a row the database rejected and continues with the rest', async () => {
    const user = userEvent.setup();
    patientApi.create
      .mockRejectedValueOnce(new Error('UNIQUE constraint failed: patients.patient_id'))
      .mockResolvedValueOnce({ id: 'p-2' });
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'roster.csv',
      data: [ROW, { ...ROW, patient_id: 'MRN-101' }],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Imported 1 patient from roster.csv'));
    expect(alertText()).toContain('Row 2: UNIQUE constraint failed: patients.patient_id');
    expect(patientApi.create).toHaveBeenCalledTimes(2);
  });

  it('pluralises the counts, and caps the listed failures at five', async () => {
    const user = userEvent.setup();
    const bad = { ...ROW, last_name: '' };
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'roster.csv',
      data: [ROW, { ...ROW, patient_id: 'MRN-101' }, bad, bad, bad, bad, bad, bad, bad],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Imported 2 patients from roster.csv'));
    const text = alertText();
    expect(text).toContain('(7 rows skipped)');
    // The count is the truth; the list is a sample of it.
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('reports a summary of zero when every row is unusable', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({
      success: true,
      filename: 'empty-roster.csv',
      data: [{ blood_type: 'A+' }],
    });
    renderPatients();
    await startImport(user);

    await waitFor(() => expect(alertText()).toContain('Imported 0 patients from empty-roster.csv'));
    expect(patientApi.create).not.toHaveBeenCalled();
  });

  it('surfaces a failure from the file bridge itself', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockRejectedValue(new Error('EACCES: permission denied'));
    renderPatients();
    await startImport(user);

    expect(await screen.findByText('EACCES: permission denied')).toBeInTheDocument();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockRejectedValue(new Error(''));
    renderPatients();
    await startImport(user);

    expect(await screen.findByText(/CSV import failed\. Please check the file/i)).toBeInTheDocument();
  });

  it('disables the import button while an import is running', async () => {
    const user = userEvent.setup();
    let finish;
    filesApi.importFile.mockReturnValue(new Promise((r) => { finish = r; }));
    renderPatients();
    await startImport(user);

    const button = await screen.findByRole('button', { name: /Import CSV/i });
    await waitFor(() => expect(button).toBeDisabled());

    finish({ success: true, filename: 'roster.csv', data: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: /Import CSV/i })).toBeEnabled());
  });

  it('clears a previous summary when a new import starts', async () => {
    const user = userEvent.setup();
    filesApi.importFile.mockResolvedValue({ success: true, filename: 'first.csv', data: [ROW] });
    renderPatients();
    await startImport(user);
    await waitFor(() => expect(alertText()).toContain('Imported 1 patient from first.csv'));

    filesApi.importFile.mockResolvedValue({ success: false, filename: 'second.csv' });
    await startImport(user);

    // A stale success banner next to a new failure reads as a successful import.
    await waitFor(() => expect(alertText()).not.toContain('first.csv'));
    expect(alertText()).toContain('could not be parsed');
  });
});
