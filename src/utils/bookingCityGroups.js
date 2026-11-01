import { KUWAIT_AREAS, KUWAIT_GOVERNORATES } from '../constants/locations';

const normalize = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();

// Keep city values unchanged: booking drafts and shop filtering use these values.
export function bookingCityGroups(branches) {
  const cities = [...new Set(branches.map(branch => branch.city).filter(Boolean))].sort();
  const groups = new Map();
  for (const city of cities) {
    const matches = KUWAIT_GOVERNORATES.filter(name => KUWAIT_AREAS[name].some(area => normalize(area) === normalize(city)));
    let governorate;
    if (matches.length === 1) {
      // Legacy shops can have a city without a saved governorate/area relation.
      governorate = { key: matches[0], name: matches[0], nameAr: '' };
    } else {
      const saved = new Map(branches.filter(branch => branch.city === city && branch.governorateName).map(branch => [
        String(branch.governorateId ?? branch.governorateName),
        { key: KUWAIT_GOVERNORATES.find(name => normalize(name) === normalize(branch.governorateName)) || `saved:${branch.governorateId ?? branch.governorateName}`, name: branch.governorateName, nameAr: branch.governorateNameAr || '' },
      ]));
      // Do not guess when a free-text city has conflicting saved locations.
      governorate = saved.size === 1 ? [...saved.values()][0] : { key: 'other', name: '', nameAr: '' };
    }
    if (!groups.has(governorate.key)) groups.set(governorate.key, { ...governorate, cities: [] });
    groups.get(governorate.key).cities.push(city);
  }
  const rank = key => key === 'other' ? Infinity : KUWAIT_GOVERNORATES.includes(key) ? KUWAIT_GOVERNORATES.indexOf(key) : KUWAIT_GOVERNORATES.length;
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}
