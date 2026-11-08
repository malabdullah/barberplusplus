import { DAY_KEYS } from '../constants/time';
export const SETUP_STEPS = ['shop', 'services', 'team', 'hours', 'review'];
export const isSetupId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const time = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
export const shopSetupUrl = (id, step) => '/dashboard/setup?' + new URLSearchParams({ shop: id, ...(SETUP_STEPS.includes(step) ? { step } : {}) });
export function setupActionUrl(path, id, step) {
  return path + (path.includes('?') ? '&' : '?') + new URLSearchParams({ setup: id, setupStep: step });
}
export function setupReturn(search, branches, userId) {
  const p = new URLSearchParams(search); const id = p.get('setup');
  if (!isSetupId(id) || !branches?.some(b => b.id === id && b.managerId === userId)) return null;
  return { id, path: shopSetupUrl(id, p.get('setupStep') || 'team') };
}
export function getShopSetup(shop, allServices = [], allBarbers = []) {
  const services = allServices.filter(s => s.branchId === shop?.id && s.status !== 'inactive' && s.name?.trim() && Number.isInteger(s.duration) && s.duration >= 5 && Number.isFinite(s.price) && s.price >= 0);
  const serviceIds = new Set(services.map(s => s.id));
  const barbers = allBarbers.filter(b => b.branchId === shop?.id && b.userId && (b.managerChair || !b.inviteStatus || b.inviteStatus === 'accepted'));
  const assigned = b => b.services?.some(id => serviceIds.has(id));
  const hours = b => Boolean(b.availabilityApprovedAt) && DAY_KEYS.some(day => {
    const h = b.availability?.[day]; const open = shop?.openingHours?.[day];
    return h?.enabled && time(h.start) && time(h.end) && h.start < h.end && open && time(open.open) && time(open.close) && h.start < open.close && h.end > open.open;
  });
  const readyBarbers = barbers.filter(b => b.status === 'active' && assigned(b) && hours(b));
  const shopHours = DAY_KEYS.some(day => { const h = shop?.openingHours?.[day]; return time(h?.open) && time(h?.close) && h.open < h.close; });
  const complete = { shop: Boolean(shop?.name?.trim() && shop.governorateId && shop.areaId && shopHours), services: services.length > 0, team: barbers.some(assigned), hours: readyBarbers.length > 0 };
  const completed = Object.values(complete).filter(Boolean).length;
  return { services, barbers, readyBarbers, complete, completed, ready: completed === 4, next: SETUP_STEPS.find(step => step !== 'review' && !complete[step]) || 'review', assigned, hours };
}
