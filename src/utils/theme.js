// Resolve old System preferences once; all new choices are explicit modes.
export function resolveTheme(value) {
  if (value === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return value === 'light' ? 'light' : 'dark';
}
