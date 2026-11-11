// The admin composer always uses Kuwait wall time, independent of device timezone.
export function kuwaitSchedule(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) {
    throw new Error('INVALID_SCHEDULE');
  }
  const date = new Date(`${value}:00+03:00`);
  if (!Number.isFinite(date.getTime()) || kuwaitInput(date) !== value) {
    throw new Error('INVALID_SCHEDULE');
  }
  return date.toISOString();
}
export function kuwaitInput(date = new Date()) {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(
    0,
    16,
  );
}
