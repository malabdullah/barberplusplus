export const getKuwaitDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export const addBookingDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const searchBranches = (branches, city, query) => {
  if (!city) return [];
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').toLocaleLowerCase().trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return branches.filter(branch => branch.city === city && terms.every(term =>
    normalize([branch.name, branch.nameAr, branch.area, branch.areaAr, branch.address].join(' ')).includes(term)));
};

export const getBarberServices = (catalog, branchId, barberId) => {
  const barber = catalog.barbers.find(item => item.id === barberId && item.branchId === branchId);
  return catalog.services.filter(service => service.branchId === branchId && barber?.serviceIds.includes(service.id));
};

export const safeBookingUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, window.location.origin); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
};

export const bookingCalendar = booking => {
  const start = new Date(`${booking.date}T${booking.time}:00+03:00`);
  const end = new Date(start.getTime() + booking.duration * 60000);
  const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escape = text => String(text || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber++//Customer booking//EN', 'BEGIN:VEVENT',
    `UID:${booking.id}@barber.test`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(booking.services.map(service => service.name).join(', '))}`,
    `LOCATION:${escape([booking.branchName, booking.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${escape(`Booking reference: ${booking.reference}`)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
};
