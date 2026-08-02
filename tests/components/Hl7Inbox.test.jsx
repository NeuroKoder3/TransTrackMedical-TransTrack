/**
 * src/pages/Hl7Inbox.jsx — paste an HL7 v2 message, preview it, then lift PID
 * and OBX into Patient and LabResult rows.
 *
 * This is the widest inbound PHI path in the desktop app and it was excluded
 * from coverage as "covered by Playwright" (finding H-8); no e2e spec opens it.
 * The behaviour that matters: nothing is written to the database until the
 * operator has parsed and reviewed the message, the ingest options the operator
 * ticked are the options actually sent, and a partial or warning-laden ingest is
 * reported as such rather than as a success.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { hl7 } = vi.hoisted(() => ({
  hl7: {
    supportedEvents: vi.fn(),
    parse: vi.fn(),
    ingest: vi.fn(),
    buildAck: vi.fn(),
  },
}));

vi.mock('@/api/apiClient', () => ({ api: { hl7 } }));

import Hl7Inbox from '@/pages/Hl7Inbox';

const PARSED_ORU = {
  message_type: 'ORU',
  trigger_event: 'R01',
  sending_app: 'LAB',
  sending_facility: 'MAIN',
  receiving_app: 'TT',
  message_control_id: 'MSG00002',
  message_datetime: '20260423130000',
  patient: {
    mrn: 'MRN-200001',
    last_name: 'DOE',
    first_name: 'JANE',
    date_of_birth: '19700515',
    sex: 'F',
    phone: '(555)555-1212',
  },
  visit: { patient_class: 'O', assigned_location: 'CLINIC', visit_number: 'V001' },
  order: {
    placer_order_number: 'ORD-001',
    filler_order_number: 'FILL-001',
    universal_service_id: 'CMP',
    observation_datetime: '20260423125500',
  },
  observations: [
    { test_code: '2160-0', test_name: 'Creatinine', value: '1.1', unit: 'mg/dL', reference_range: '0.6-1.2' },
    { test_code: '1751-7', value: '4.0' },
  ],
  warnings: [],
};

const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Hl7Inbox />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hl7.supportedEvents.mockResolvedValue(['A01', 'A03', 'A04', 'A08', 'R01']);
  hl7.parse.mockResolvedValue(PARSED_ORU);
  hl7.ingest.mockResolvedValue({ ok: true, patient: null, labs: { inserted: 0, skipped: 0 }, warnings: [] });
  hl7.buildAck.mockResolvedValue({ ack: 'MSH|^~\\&|TT|MAIN|LAB|MAIN|...|ACK\rMSA|AA|MSG00002' });
});

describe('Hl7Inbox', () => {
  it('lists the supported trigger events so an operator knows what will parse', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /HL7 v2 Inbox/i })).toBeInTheDocument();
    expect(await screen.findByText('A01')).toBeInTheDocument();
    for (const event of ['A03', 'A04', 'A08', 'R01']) {
      expect(screen.getByText(event)).toBeInTheDocument();
    }
  });

  it('will not parse or ingest before a message is entered', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /^Parse$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ingest into database/i })).toBeDisabled();
    expect(screen.getByText(/Parse a message first/i)).toBeInTheDocument();
    expect(screen.getByText(/Parse a message to see its structure/i)).toBeInTheDocument();
  });

  it('treats a whitespace-only message as empty', async () => {
    const user = setupUser();
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), '   ');
    expect(screen.getByRole('button', { name: /^Parse$/i })).toBeDisabled();
  });

  it('loads a sample ADT message into the editor and parses it verbatim', async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Load ADT\^A04 sample/i }));

    const editor = screen.getByPlaceholderText(/MSH/);
    expect(editor.value).toContain('ADT^A04');
    expect(editor.value).toContain('PID|1||MRN-200001');

    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await waitFor(() => expect(hl7.parse).toHaveBeenCalledTimes(1));
    // The parser is handed the message exactly as held in state, with the CR
    // segment terminators intact — a textarea's `.value` normalises those to LF,
    // so the raw string is what must be forwarded.
    const forwarded = hl7.parse.mock.calls[0][0];
    expect(forwarded).toContain('ADT^A04');
    expect(forwarded.split('\r')).toHaveLength(4);
  });

  it('loads a sample ORU message', async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Load ORU\^R01 sample/i }));
    expect(screen.getByPlaceholderText(/MSH/).value).toContain('ORU^R01');
    expect(screen.getByPlaceholderText(/MSH/).value).toContain('OBX|1|NM|2160-0');
  });

  it('renders the parsed MSH, PID, PV1, OBR and OBX segments', async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Load ORU\^R01 sample/i }));
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));

    // Once as the badge on the preview, once in the parsed MSH summary.
    expect(await screen.findAllByText('ORU^R01')).toHaveLength(2);
    expect(screen.getByText('MSH')).toBeInTheDocument();
    expect(screen.getByText('MSG00002')).toBeInTheDocument();
    expect(screen.getByText('PID — Patient')).toBeInTheDocument();
    expect(screen.getByText('MRN-200001')).toBeInTheDocument();
    expect(screen.getByText('DOE, JANE')).toBeInTheDocument();
    expect(screen.getByText('19700515')).toBeInTheDocument();
    expect(screen.getByText('PV1 — Visit')).toBeInTheDocument();
    expect(screen.getByText('V001')).toBeInTheDocument();
    expect(screen.getByText('OBR — Order')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('OBX — Observations (2)')).toBeInTheDocument();
    expect(screen.getByText(/2160-0 · Creatinine/)).toBeInTheDocument();
    expect(screen.getByText('1.1')).toBeInTheDocument();
    expect(screen.getByText('0.6-1.2')).toBeInTheDocument();
  });

  it('marks absent PID fields rather than leaving them blank', async () => {
    const user = setupUser();
    hl7.parse.mockResolvedValue({
      message_type: 'ADT',
      trigger_event: 'A04',
      patient: { mrn: null, last_name: null, first_name: null, date_of_birth: null, sex: null, phone: null },
      observations: [],
      warnings: [],
    });
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));

    expect(await screen.findByText('?, ?')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('omits segments the message does not contain', async () => {
    const user = setupUser();
    hl7.parse.mockResolvedValue({ message_type: 'ADT', trigger_event: 'A03', observations: [], warnings: [] });
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));

    await screen.findByText('MSH');
    expect(screen.queryByText('PID — Patient')).not.toBeInTheDocument();
    expect(screen.queryByText('PV1 — Visit')).not.toBeInTheDocument();
    expect(screen.queryByText('OBR — Order')).not.toBeInTheDocument();
    expect(screen.queryByText(/OBX — Observations/)).not.toBeInTheDocument();
  });

  it('shows parser warnings prominently', async () => {
    const user = setupUser();
    hl7.parse.mockResolvedValue({
      ...PARSED_ORU,
      warnings: ['OBX-3 has no LOINC code', 'PID-8 sex not recognised'],
    });
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    expect(await screen.findByText(/OBX-3 has no LOINC code; PID-8 sex not recognised/)).toBeInTheDocument();
  });

  it('reports an unparseable message and offers nothing to ingest', async () => {
    const user = setupUser();
    hl7.parse.mockRejectedValue(new Error('MSH segment missing'));
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'garbage');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));

    expect(await screen.findByText('MSH segment missing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ingest into database/i })).toBeDisabled();
    expect(screen.getByText(/Parse a message to see its structure/i)).toBeInTheDocument();
  });

  it('shows an unknown message type as ? rather than crashing', async () => {
    const user = setupUser();
    hl7.parse.mockResolvedValue({ message_type: null, trigger_event: null, observations: [], warnings: [] });
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    expect(await screen.findByText('?')).toBeInTheDocument();
    expect(screen.getByText('?^?')).toBeInTheDocument();
  });

  it('clears the editor, the preview and any previous result together', async () => {
    const user = setupUser();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Load ORU\^R01 sample/i }));
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await screen.findByText('PID — Patient');

    await user.click(screen.getByRole('button', { name: /Clear/i }));
    // Leaving parsed PHI on screen after a clear is exactly the leak this guards.
    expect(screen.getByPlaceholderText(/MSH/).value).toBe('');
    expect(screen.queryByText('MRN-200001')).not.toBeInTheDocument();
    expect(screen.getByText(/Parse a message to see its structure/i)).toBeInTheDocument();
  });

  it('shows the parsed JSON on request', async () => {
    const user = setupUser();
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await user.click(await screen.findByRole('tab', { name: /Raw JSON/i }));
    expect(await screen.findByText(/"message_control_id": "MSG00002"/)).toBeInTheDocument();
  });

  it('builds an application-accept ACK from the parsed message', async () => {
    const user = setupUser();
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await user.click(await screen.findByRole('tab', { name: /Build ACK/i }));
    await user.click(screen.getByRole('button', { name: /Build ACK \(AA\)/i }));

    await waitFor(() =>
      expect(hl7.buildAck).toHaveBeenCalledWith({
        parsed_or_raw: PARSED_ORU,
        code: 'AA',
        message: 'Accepted',
      })
    );
    expect(await screen.findByText(/MSA\|AA\|MSG00002/)).toBeInTheDocument();
  });

  it('reports a failed ACK build instead of showing a stale ACK', async () => {
    const user = setupUser();
    hl7.buildAck.mockRejectedValue(new Error('cannot ACK an ACK'));
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await user.click(await screen.findByRole('tab', { name: /Build ACK/i }));
    await user.click(screen.getByRole('button', { name: /Build ACK \(AA\)/i }));
    await waitFor(() => expect(hl7.buildAck).toHaveBeenCalled());
    expect(screen.queryByText(/MSA\|AA/)).not.toBeInTheDocument();
  });
});

describe('lifting a message into the database', () => {
  async function parseFirst(user) {
    renderPage();
    await user.type(screen.getByPlaceholderText(/MSH/), 'MSH|x');
    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    await screen.findByText('PID — Patient');
  }

  it('defaults every write option to on and sends them with the parsed message', async () => {
    const user = setupUser();
    hl7.ingest.mockResolvedValue({
      ok: true,
      patient: { action: 'created', mrn: 'MRN-200001', last_name: 'DOE', first_name: 'JANE' },
      labs: { inserted: 3, skipped: 0 },
      warnings: [],
    });
    await parseFirst(user);
    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));

    await waitFor(() =>
      expect(hl7.ingest).toHaveBeenCalledWith({
        parsed: PARSED_ORU,
        options: { createPatient: true, updateDemographics: true, ingestObservations: true },
      })
    );

    await screen.findByText('Ingest result');
    expect(screen.getByText('CREATED · DOE, JANE · MRN MRN-200001')).toBeInTheDocument();
    const inserted = screen.getByText('Labs inserted').parentElement;
    expect(inserted.textContent).toBe('Labs inserted3');
  });

  it('sends exactly the options the operator unticked', async () => {
    const user = setupUser();
    await parseFirst(user);

    const [createPatient, updateDemographics, ingestObservations] =
      screen.getAllByRole('checkbox');
    expect(createPatient).toBeChecked();
    await user.click(createPatient);
    await user.click(ingestObservations);
    expect(createPatient).not.toBeChecked();
    expect(updateDemographics).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));
    await waitFor(() =>
      expect(hl7.ingest).toHaveBeenCalledWith({
        parsed: PARSED_ORU,
        options: { createPatient: false, updateDemographics: true, ingestObservations: false },
      })
    );
  });

  it('states plainly when no patient row was touched', async () => {
    const user = setupUser();
    hl7.ingest.mockResolvedValue({ ok: true, patient: null, labs: { inserted: 0, skipped: 2 }, warnings: [] });
    await parseFirst(user);
    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));
    expect(await screen.findByText('No patient action')).toBeInTheDocument();
  });

  it('reports a not-ok ingest with its warnings rather than as a success', async () => {
    const user = setupUser();
    hl7.ingest.mockResolvedValue({
      ok: false,
      patient: null,
      labs: { inserted: 0, skipped: 3 },
      warnings: ['unknown MRN and createPatient disabled', 'OBX-2 unparseable'],
    });
    await parseFirst(user);
    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));

    expect(await screen.findByText(/unknown MRN and createPatient disabled; OBX-2 unparseable/))
      .toBeInTheDocument();
    // The skipped count must be visible; silently dropping lab rows is the
    // failure mode this reports.
    await screen.findByText('Ingest result');
    expect(screen.getByText('Labs skipped').parentElement.textContent).toBe('Labs skipped3');
    expect(screen.getByText('Labs inserted').parentElement.textContent).toBe('Labs inserted0');
  });

  it('reports a rejected ingest and shows no result card', async () => {
    const user = setupUser();
    hl7.ingest.mockRejectedValue(new Error('transaction rolled back'));
    await parseFirst(user);
    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));
    await waitFor(() => expect(hl7.ingest).toHaveBeenCalled());
    expect(screen.queryByText('Ingest result')).not.toBeInTheDocument();
  });

  it('drops a previous ingest result when the message is re-parsed', async () => {
    const user = setupUser();
    hl7.ingest.mockResolvedValue({ ok: true, patient: null, labs: { inserted: 1, skipped: 0 }, warnings: [] });
    await parseFirst(user);
    await user.click(screen.getByRole('button', { name: /Ingest into database/i }));
    await screen.findByText('Ingest result');

    await user.click(screen.getByRole('button', { name: /^Parse$/i }));
    // A result from the previous message must not be attributed to the new one.
    await waitFor(() => expect(screen.queryByText('Ingest result')).not.toBeInTheDocument());
  });

  it('states that the whole lift happens in one transaction', async () => {
    renderPage();
    expect(await screen.findByText(/nothing is written if anything fails/i)).toBeInTheDocument();
  });
});
