export const nativeWalletReturnUrl = 'https://barber-open-test.alabdullah-cs.workers.dev/payments/provider-return';

export function requestsNativeWallet(req: Request): boolean {
  return req.headers.get('x-barber-native-wallet') === '1';
}
