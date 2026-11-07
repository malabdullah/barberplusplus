import { expect, it } from 'vitest';
import { bookingServices } from './bookingServices';
import { validateImageFile } from './imageValidation';

it('keeps the purchased description and price when a service is renamed or archived', () => {
  const booking = { serviceIds: ['s'], serviceSnapshot: [{ id: 's', name: 'Original haircut', price: 3.125 }] };
  expect(bookingServices(booking, [{ id: 's', name: 'New name', price: 8, status: 'inactive' }]))
    .toEqual([{ id: 's', name: 'Original haircut', nameAr: undefined, price: 3.125 }]);
});
it('preserves repeated service line quantities in a snapshot', () => {
  const line = { id: 's', name: 'Haircut' };
  expect(bookingServices({ serviceSnapshot: [line, line] })).toHaveLength(2);
});
it('rejects unsupported previews and oversized files before any upload', () => {
  expect(() => validateImageFile({ name: 'logo.svg', type: 'image/svg+xml', size: 100 })).toThrow('Invalid file type');
  expect(() => validateImageFile({ name: 'logo.png', type: 'image/png', size: 5242881 })).toThrow('File too large');
  expect(() => validateImageFile({ name: 'logo.svg', type: 'image/png', size: 100 })).toThrow('extension');
  expect(validateImageFile({ name: 'logo.png', type: 'image/png', size: 100 })).toBe(true);
});
