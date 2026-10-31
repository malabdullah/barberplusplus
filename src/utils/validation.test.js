import { expect, it } from 'vitest';
import { validatePassword } from './validation';
it('accepts eight-character customer passwords while preserving the staff default', () => {
  expect(validatePassword('Short12!', { minLength: 8 }).valid).toBe(true);
  expect(validatePassword('Short12!').valid).toBe(false);
  expect(validatePassword('Short1!', { minLength: 8 }).valid).toBe(false);
  expect(validatePassword('short123', { minLength: 8 }).valid).toBe(false);
});
