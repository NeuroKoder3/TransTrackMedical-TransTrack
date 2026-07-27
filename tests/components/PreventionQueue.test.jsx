/**
 * PreventionQueue Page Component Tests
 *
 * Validates the inactivation prevention action queue UI:
 * - Renders the page heading and non-clinical disclaimer
 * - Renders ranked queue entries with recommended actions
 * - Empty state when the queue is clear
 * - Records an intervention through the Log Action dialog
 * - Shows the measured-outcomes table
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const QUEUE_REPORT = {
  queueVersion: '1.0.0',
  modelVersion: '2.0.0',
  generatedAtISO: '2026-07-27T12:00:00Z',
  candidatesScreened: 42,
  queueSize: 2,
  distribution: { critical: 1, high: 1, moderate: 5, low: 20, none: 15 },
  queue: [
    {
      patientId: 'p1',
      patientName: 'Jane Rivers',
      mrn: 'MRN-001',
      organNeeded: 'kidney',
      score: 78.5,
      riskLevel: 'critical',
      probabilityWithin90Days: 0.62,
      daysUntilEvaluationExpiry: 12,
      queuePriority: 117.8,
      recommendedAction: {
        factor: 'EVAL_EXPIRY',
        actionType: 'refreshEvaluation',
        actionDescription: 'Schedule re-evaluation before expiry',
        expectedScoreAfterAction: 48.2,
        expectedScoreReduction: 30.3,
        expectedNewRiskLevel: 'moderate',
        expectedProbabilityReduction: 0.21,
      },
      topThreeFactors: [
        { factor: 'EVAL_EXPIRY', weightedContribution: 30, shareOfScore: 0.4, rawSubscore: 100 },
        { factor: 'BARRIERS', weightedContribution: 20, shareOfScore: 0.25, rawSubscore: 80 },
      ],
      modelVersion: '2.0.0',
    },
    {
      patientId: 'p2',
      patientName: 'Tom Okafor',
      mrn: 'MRN-002',
      organNeeded: 'liver',
      score: 55.1,
      riskLevel: 'high',
      probabilityWithin90Days: 0.34,
      daysUntilEvaluationExpiry: null,
      queuePriority: 55.1,
      recommendedAction: null,
      topThreeFactors: [],
      modelVersion: '2.0.0',
    },
  ],
  coordinatorOverloads: [],
  aggregateExpectedImpact: {
    projectedProbabilityReductionWithin90Days: 0.21,
    projectedInactivationsAvoidedWithin90Days: 0.2,
  },
  disclaimer: 'Operational coordination signal. Not a clinical recommendation.',
};

const EFFECTIVENESS = {
  windowDays: 90,
  perInterventionType: [
    {
      interventionType: 'refreshEvaluation',
      recorded: 5,
      measured: 3,
      averageScoreDelta: 18.2,
      averageProbability90Delta: 0.12,
    },
  ],
  totals: { recorded: 5, measured: 3, weightedAvgScoreDelta: 18.2, weightedAvgProb90Delta: 0.12 },
};

const DIGEST = {
  digestVersion: '1.0.0',
  modelVersion: '2.0.0',
  headline: {
    activeCandidatesScreened: 42,
    expectedInactivationsBaseline: 4.1,
    expectedInactivationsAfterRecommendedActions: 2.9,
    inactivationsAvoided: 1.2,
    estimatedDollarsAvoided: 120000,
    coordinatorOverloads: [],
  },
  disclaimer: 'Operational coordination signal.',
};

beforeEach(() => {
  window.electronAPI = {
    ...window.electronAPI,
    actionQueue: {
      build: vi.fn().mockResolvedValue(QUEUE_REPORT),
      topInterventionsForPatient: vi.fn().mockResolvedValue({ topInterventions: [] }),
      recordIntervention: vi.fn().mockResolvedValue({
        id: 'iv1',
        assessmentBefore: {
          score: 78.5, riskLevel: 'critical',
          probabilityWithin90Days: 0.62, modelVersion: '2.0.0',
        },
      }),
      recordOutcome: vi.fn().mockResolvedValue({ updated: true, measured_score_delta: 12.5 }),
      getInterventionsForPatient: vi.fn().mockResolvedValue([]),
      getInterventionEffectiveness: vi.fn().mockResolvedValue(EFFECTIVENESS),
      buildDigest: vi.fn().mockResolvedValue(DIGEST),
    },
  };
});

import PreventionQueue from '@/pages/PreventionQueue';

function renderPreventionQueue() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <PreventionQueue />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('PreventionQueue Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText('Prevention Action Queue')).toBeInTheDocument();
    });
  });

  it('shows the non-clinical disclaimer', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText(/Non-Clinical Notice/i)).toBeInTheDocument();
    });
  });

  it('renders ranked queue entries with recommended actions', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText('Jane Rivers')).toBeInTheDocument();
    });
    expect(screen.getByText('Tom Okafor')).toBeInTheDocument();
    expect(screen.getByText(/Schedule re-evaluation before expiry/i)).toBeInTheDocument();
    expect(screen.getByText(/Eval expires in 12d/i)).toBeInTheDocument();
  });

  it('shows summary tiles with screened and queue counts', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    expect(screen.getByText(/1 critical, 1 high/i)).toBeInTheDocument();
  });

  it('shows empty state when the queue is clear', async () => {
    window.electronAPI.actionQueue.build.mockResolvedValueOnce({
      ...QUEUE_REPORT,
      queueSize: 0,
      queue: [],
    });
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText(/Queue is clear/i)).toBeInTheDocument();
    });
  });

  it('records an intervention through the Log Action dialog', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText('Jane Rivers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Log Action/i })[0]);
    await waitFor(() => {
      expect(screen.getByText('Log Prevention Action')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Record Action/i }));
    await waitFor(() => {
      expect(window.electronAPI.actionQueue.recordIntervention).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p1',
          interventionType: 'refreshEvaluation',
          targetFactor: 'EVAL_EXPIRY',
        })
      );
    });
  });

  it('surfaces measured-outcome counts from the effectiveness report', async () => {
    renderPreventionQueue();
    await waitFor(() => {
      expect(screen.getByText('Jane Rivers')).toBeInTheDocument();
    });
    // The "Actions Measured" tile renders measured/recorded from the report
    await waitFor(() => {
      expect(window.electronAPI.actionQueue.getInterventionEffectiveness).toHaveBeenCalled();
      expect(screen.getByText('/ 5')).toBeInTheDocument();
    });
  });
});
