import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './TopBar';
const state = vi.hoisted(() => ({ branches: [], selectedBranch: null, notifications: [], unreadCount: 0 }));
vi.mock('../../context/AppContext', () => ({ useApp: () => state }));
vi.mock('../../lib/runtimeConfig', () => ({ customerFeaturesEnabled: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) }));
vi.mock('../../services', () => ({ notificationPreferencesService: {} }));
vi.mock('../UI/AccountModeSwitch', () => ({ default: () => null }));
vi.mock('../UI/LanguageSelector', () => ({ default: () => null }));
vi.mock('../UI/ThemeSelector', () => ({ default: () => null }));
afterEach(cleanup);
it('offers no empty shop selector before a manager creates a shop', () => {
  state.branches = []; state.selectedBranch = null;
  render(<MemoryRouter><TopBar /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'branches.selectBranch' })).not.toBeInTheDocument();
});
it('shows the shop selector after a shop exists', () => {
  state.branches = [{ id: 'shop', name: 'My Shop' }]; state.selectedBranch = state.branches[0];
  render(<MemoryRouter><TopBar /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'My Shop' })).toBeInTheDocument();
});
