import { bookingRPC, recoveredServiceNames } from './native-compatibility.ts';
const equal = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Values differ');
};

Deno.test('native RPC is limited to cloud Test and production keeps the existing booking RPC', () => {
  equal(bookingRPC('book', true), 'native_customer_booking');
  equal(bookingRPC('slots', true), 'customer_booking');
  equal(bookingRPC('book', false), 'customer_booking');
});
Deno.test('recovered receipts preserve purchased names and order after services are renamed or retired', async () => {
  const snapshot = [{ id: 'second', name: 'Original beard', name_ar: 'اللحية الأصلية' }, { id: 'first', name: 'Original haircut', name_ar: null }];
  let calls = 0;
  const result = await recoveredServiceNames(snapshot, ['first', 'second'], () => {
    calls++; return Promise.resolve([{ id: 'first', name: 'Renamed haircut', name_ar: null }]);
  });
  equal(result, [{ name: 'Original beard', name_ar: 'اللحية الأصلية' }, { name: 'Original haircut', name_ar: null }]);
  equal(calls, 0);
});
Deno.test('legacy empty snapshot lookup is bounded and ordered by purchased service IDs', async () => {
  const result = await recoveredServiceNames([], ['second', 'first'], ids => {
    equal(ids, ['second', 'first']);
    return Promise.resolve([{ id: 'first', name: 'Haircut', name_ar: null }, { id: 'second', name: 'Beard', name_ar: 'لحية' }]);
  });
  equal(result, [{ name: 'Beard', name_ar: 'لحية' }, { name: 'Haircut', name_ar: null }]);
});
Deno.test('malformed nonempty snapshots and oversized legacy selections never fall back to live names', async () => {
  let calls = 0;
  for (const [snapshot, ids] of [[[{ name: 42 }], ['first']], [[], Array.from({ length: 11 }, (_, i) => String(i))]] as const) {
    let rejected = false;
    try { await recoveredServiceNames(snapshot, [...ids], () => { calls++; return Promise.resolve([]); }); }
    catch { rejected = true; }
    equal(rejected, true);
  }
  equal(calls, 0);
});
