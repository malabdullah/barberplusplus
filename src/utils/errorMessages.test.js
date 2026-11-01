import { expect, it } from 'vitest';
import { getErrorKey, getErrorMessage } from './errorMessages';
it('reports global phone conflicts without exposing database details and uses the active language', () => {
  const error={code:'23505',message:'PHONE_IN_USE'};
  expect(getErrorKey(error)).toBe('errors.phoneInUse');
  expect(getErrorMessage(error,'fallback',key=>`translated:${key}`)).toBe('translated:errors.phoneInUse');
  expect(getErrorMessage('PHONE_REGISTRATION_CONFLICT','fallback',key=>`translated:${key}`)).toBe('translated:errors.phoneRegistrationConflict');
  expect(getErrorMessage({message:'unrelated private failure'},'safe')).toBe('safe');
});
