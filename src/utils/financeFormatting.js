export const financeMetrics = ['salesFils', 'expenseFils', 'operatingFils', 'netReceiptsFils', 'expensePaidFils', 'cashFlowFils'];
export function parseFinanceAmount(value) {
  const normalized = String(value).trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/٫/g, '.');
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const amount = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return amount > 0 && amount <= 1000000000 ? String(amount) : null;
}
export function financeToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
