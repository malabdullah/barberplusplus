import { createAccountToolsHandler } from "./handler.ts";
const assert = (v: unknown) => {
  if (!v) throw Error("Assertion failed");
};
const runtime = {
  environment: "test",
  appUrl: "http://localhost:5173",
  publicUrl: "http://127.0.0.1:54321",
  secret: "s".repeat(64),
};
const identity = {
  user_id: "a0000000-0000-4000-8000-000000000001",
  session_id: "a0000000-0000-4000-8000-000000000002",
  role: "manager",
  aal: "aal1",
};
const request = (body: unknown, origin = runtime.appUrl) =>
  new Request(runtime.appUrl, {
    method: "POST",
    headers: { origin, authorization: "Bearer verified" },
    body: JSON.stringify(body),
  });
Deno.test("account tools rejects guest, unknown role, admin without MFA and untrusted origins before RPC", async () => {
  for (
    const [who, status] of [[null, 401], [
      { ...identity, role: "unknown" },
      403,
    ], [{ ...identity, role: "admin" }, 403]] as const
  ) {
    let calls = 0;
    const handle = createAccountToolsHandler({
      ...runtime,
      authenticate: async () => who,
      rpc: async () => {
        calls++;
      },
    });
    assert((await handle(request({ action: "sessions" }))).status === status);
    assert(calls === 0);
  }
  let calls = 0;
  const handle = createAccountToolsHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async () => {
      calls++;
    },
  });
  assert(
    (await handle(request({ action: "sessions" }, "https://untrusted.example")))
      .status === 403,
  );
  assert(calls === 0);
});
Deno.test("account tools never accepts client identity or privileged arbitrary actions", async () => {
  let data: Record<string, unknown> = {};
  const handle = createAccountToolsHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async (_, value) => {
      data = value;
      return {};
    },
  });
  assert(
    (await handle(
      request({
        action: "sessions",
        user_id: "forged",
        session_id: "forged",
        aal: "aal2",
        role: "admin",
      }),
    )).status === 200,
  );
  assert(
    data.user_id === identity.user_id &&
      data.session_id === identity.session_id && data.aal === "aal1",
  );
  for (
    const body of [
      { action: "dispatch" },
      { action: "revoke-session", targetId: "bad" },
      { action: "activity", view: "all" },
      { action: "activity", view: "work", cursor: "0" },
      { action: "sessions", cursor: { id: "bad", createdAt: "2026-11-12" } },
    ]
  ) assert((await handle(request(body))).status === 400);
});
Deno.test("account tools applies bounded request size, safe failures and no-store", async () => {
  const handle = createAccountToolsHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async () => {
      throw Error("internal database detail");
    },
  });
  const result = await handle(request({ action: "sessions" }));
  assert(
    result.status === 503 && result.headers.get("cache-control") === "no-store",
  );
  assert((await result.json()).error === "UNAVAILABLE");
  assert(
    (await handle(request({ action: "sessions", padding: "x".repeat(4096) })))
      .status === 413,
  );
  const expired = createAccountToolsHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async () => {
      throw Error("AUTH_REQUIRED");
    },
  });
  assert((await expired(request({ action: "status" }))).status === 401);
});
