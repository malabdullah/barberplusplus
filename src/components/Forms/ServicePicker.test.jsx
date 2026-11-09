import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ServicePicker from './ServicePicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: key => key, i18n: { language: 'ar' } }) }));
afterEach(cleanup);
const services = [{ id: 'hair', name: 'Haircut', nameAr: 'قص الشعر', duration: 30, price: 3 }, { id: 'beard', name: 'Beard', duration: 15, price: 2 }];

it('keeps package components selected and locked while extra services remain selectable', () => {
  const onToggle = vi.fn();
  render(<ServicePicker services={services} selectedIds={['hair']} includedIds={['hair']} onToggle={onToggle} label="Services" />);
  const included = screen.getByRole('checkbox', { name: /قص الشعر/ });
  expect(included).toBeChecked();
  expect(included).toBeDisabled();
  const extra = screen.getByRole('checkbox', { name: /Beard/ });
  expect(extra).toBeEnabled();
  fireEvent.click(extra);
  expect(onToggle).toHaveBeenCalledWith('beard');
  expect(screen.getByText('2.000 common.currency')).toBeInTheDocument();
});

it('preserves selection limits without preventing removal of an existing selection', () => {
  const onToggle = vi.fn();
  const { rerender } = render(<ServicePicker services={services} selectedIds={['hair']} onToggle={onToggle} isOptionDisabled={service => service.id !== 'hair'} />);
  expect(screen.getByRole('checkbox', { name: /Beard/ })).toBeDisabled();
  const selected = screen.getByRole('checkbox', { name: /قص الشعر/ });
  expect(selected).toBeEnabled();
  fireEvent.click(selected);
  expect(onToggle).toHaveBeenCalledWith('hair');
  rerender(<ServicePicker services={services} selectedIds={['hair']} onToggle={onToggle} disabled />);
  expect(screen.getByRole('checkbox', { name: /قص الشعر/ })).toBeDisabled();
});
