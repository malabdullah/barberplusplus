-- Deferred constraints run at transaction end, after the API definer has
-- returned to the authenticated caller. This private, non-callable trigger
-- needs owner privileges solely to validate its protected ledger entries.
alter function private.settlement_balanced() security definer;
