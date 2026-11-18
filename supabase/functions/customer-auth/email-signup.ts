type SignupResult = 'exists' | void;
type SignupDependencies = {
  lookup: (email: string) => Promise<{ confirmed: boolean } | null>;
  create: (name: string, email: string, password: string) => Promise<{ code?: string } | null>;
  deliver: (email: string, password: string, returnTo: string, created: boolean) => Promise<void>;
};

// Only explicit Auth collision codes establish that an address is occupied.
// Availability, validation and mail failures must never become duplicate errors.
export function createCustomerEmailSignup(deps: SignupDependencies) {
  return async (name: string, email: string, password: string, returnTo: string): Promise<SignupResult> => {
    const existing = await deps.lookup(email);
    if (existing?.confirmed) return 'exists';
    if (existing) {
      await deps.deliver(email, password, returnTo, false);
      return;
    }
    const failure = await deps.create(name, email, password);
    if (failure) {
      if (failure.code === 'email_exists' || failure.code === 'user_already_exists') return 'exists';
      throw Error('UNAVAILABLE');
    }
    await deps.deliver(email, password, returnTo, true);
  };
}
