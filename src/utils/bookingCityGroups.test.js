import { expect, it } from 'vitest';
import { bookingCityGroups } from './bookingCityGroups';

it('groups legacy cities under Kuwait governorates without duplicating cities or changing values', () => {
  const branches = [{ city: 'Salmiya' }, { city: 'Kuwait City' }, { city: 'Salmiya' }, { city: '' }];
  expect(bookingCityGroups(branches)).toMatchObject([
    { key: 'Al Asimah (Capital)', cities: ['Kuwait City'] },
    { key: 'Hawalli', cities: ['Salmiya'] },
  ]);
  expect(branches).toHaveLength(4);
});

it('uses saved governorates for new areas and merges them into an existing governorate group', () => {
  expect(bookingCityGroups([
    { city: 'Salmiya' },
    { city: 'New district', governorateId: 2, governorateName: 'Hawalli', governorateNameAr: 'حولي' },
    { city: 'New city', governorateId: 55, governorateName: 'New governorate', governorateNameAr: 'محافظة جديدة' },
  ])).toMatchObject([
    { key: 'Hawalli', cities: ['New district', 'Salmiya'] },
    { key: 'saved:55', nameAr: 'محافظة جديدة', cities: ['New city'] },
  ]);
});

it('keeps unknown or conflicting locations selectable without guessing their governorate', () => {
  expect(bookingCityGroups([
    { city: 'Unknown' },
    { city: 'Doha' },
    { city: 'Shared name', governorateId: 7, governorateName: 'One' },
    { city: 'Shared name', governorateId: 8, governorateName: 'Two' },
  ])).toMatchObject([{ key: 'other', cities: ['Doha', 'Shared name', 'Unknown'] }]);
});
