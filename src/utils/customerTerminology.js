let role = null;
export const setTerminologyRole = value => { role = value; };
export const shopWording = value => typeof value === 'string' ? value
  .replace(/\bbranches\b/gi, word => word[0] === 'B' ? 'Shops' : 'shops')
  .replace(/\bbranch\b/gi, word => word[0] === 'B' ? 'Shop' : 'shop')
  .replace(/فروع/g, 'صالونات').replace(/فرع/g, 'صالون') : value;
export const shopTerminology = {
  type: 'postProcessor', name: 'shopTerminology',
  process: value => role === 'admin' ? value : shopWording(value),
};
