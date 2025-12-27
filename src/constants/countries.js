// GCC Countries for phone number input
export const GCC_COUNTRIES = [
  { code: '+965', country: 'KW', label: 'Kuwait (+965)', pattern: /^[569]\d{7}$/ },
  { code: '+966', country: 'SA', label: 'Saudi Arabia (+966)', pattern: /^5\d{8}$/ },
  { code: '+971', country: 'AE', label: 'UAE (+971)', pattern: /^5\d{8}$/ },
  { code: '+973', country: 'BH', label: 'Bahrain (+973)', pattern: /^\d{8}$/ },
  { code: '+974', country: 'QA', label: 'Qatar (+974)', pattern: /^[3567]\d{7}$/ },
  { code: '+968', country: 'OM', label: 'Oman (+968)', pattern: /^[79]\d{7}$/ },
];

export default GCC_COUNTRIES;
