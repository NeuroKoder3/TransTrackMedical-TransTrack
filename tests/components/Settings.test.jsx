/**
 * Settings Page Component Tests
 *
 * Validates the system settings UI:
 * - Renders heading for admin users
 * - Shows admin-only restriction for non-admins
 * - Displays user statistics cards
 * - Shows audit log section
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

const mockMe = vi.fn();
const mockUserList = vi.fn();
const mockAuditList = vi.fn();

vi.mock('@/api/apiClient', () => ({
  api: {
    auth: {
      me: (...args) => mockMe(...args),
    },
    entities: {
      User: {
        list: (...args) => mockUserList(...args),
      },
      AuditLog: {
        list: (...args) => mockAuditList(...args),
      },
    },
  },
}));

import Settings from '@/pages/Settings';

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HashRouter>
        <Settings />
      </HashRouter>
    </QueryClientProvider>
  );
}

describe('Settings Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders admin-only restriction for non-admin user', async () => {
    mockMe.mockResolvedValue({ id: 'u1', email: 'coord@test.com', role: 'coordinator' });
    mockUserList.mockResolvedValue([]);
    mockAuditList.mockResolvedValue([]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText(/Admin Access Required/i)).toBeInTheDocument();
    });
  });

  it('renders System Settings heading for admin user', async () => {
    mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
    mockUserList.mockResolvedValue([
      { id: 'u1', email: 'admin@test.com', role: 'admin', full_name: 'Admin', created_at: '2025-01-01T00:00:00Z' },
    ]);
    mockAuditList.mockResolvedValue([]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('System Settings')).toBeInTheDocument();
    });
  });

  it('shows Total Users card for admin', async () => {
    mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
    mockUserList.mockResolvedValue([
      { id: 'u1', email: 'admin@test.com', role: 'admin', full_name: 'Admin', created_at: '2025-01-01T00:00:00Z' },
      { id: 'u2', email: 'coord@test.com', role: 'coordinator', full_name: 'Coord', created_at: '2025-02-01T00:00:00Z' },
    ]);
    mockAuditList.mockResolvedValue([]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Total Users')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('shows Administrators count card for admin', async () => {
    mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
    mockUserList.mockResolvedValue([
      { id: 'u1', email: 'admin@test.com', role: 'admin', full_name: 'Admin', created_at: '2025-01-01T00:00:00Z' },
      { id: 'u2', email: 'coord@test.com', role: 'coordinator', full_name: 'Coord', created_at: '2025-02-01T00:00:00Z' },
    ]);
    mockAuditList.mockResolvedValue([]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Administrators')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('shows Recent Actions card for admin', async () => {
    mockMe.mockResolvedValue({ id: 'u1', email: 'admin@test.com', role: 'admin' });
    mockUserList.mockResolvedValue([
      { id: 'u1', email: 'admin@test.com', role: 'admin', full_name: 'Admin', created_at: '2025-01-01T00:00:00Z' },
    ]);
    mockAuditList.mockResolvedValue([
      { id: 'al1', action: 'login', user_email: 'admin@test.com', created_at: '2025-12-01T00:00:00Z' },
    ]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Recent Actions')).toBeInTheDocument();
    });
  });
});
