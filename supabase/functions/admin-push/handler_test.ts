import { createAdminPushHandler } from "./handler.ts";
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
  role: "admin",
  aal: "aal2",
};
const request = (body: unknown, token = "good", origin = runtime.appUrl) =>
  new Request(runtime.appUrl, {
    method: "POST",
    headers: { origin, authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
Deno.test("announcement admin endpoint enforces authentication, role and MFA before accessing data", async () => {
  for (
    const [who, status] of [[null, 401], [
      { ...identity, role: "manager" },
      403,
    ], [{ ...identity, aal: "aal1" }, 403]] as const
  ) {
    let calls = 0;
    const handle = createAdminPushHandler({
      ...runtime,
      authenticate: async () => who,
      rpc: async () => {
        calls++;
      },
    });
    assert((await handle(request({ action: "history" }))).status === status);
    assert(calls === 0);
  }
});
Deno.test("announcement caller identity is server derived; worker and arbitrary actions cannot be called", async () => {
  let data: Record<string, unknown> = {};
  const handle = createAdminPushHandler({
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
        action: "preview",
        filters: { roles: ["customer"] },
        titleEn: "Hello",
        bodyEn: "World",
        user_id: "forged",
        session_id: "forged",
        mode: "apns",
      }),
    )).status === 200,
  );
  assert(
    data.user_id === identity.user_id &&
      data.session_id === identity.session_id && !("mode" in data),
  );
  for (const action of ["configure", "claim", "finish", "delete", null]) {
    assert((await handle(request({ action }))).status === 400);
  }
  assert(
    (await handle(
      request({ action: "history" }, "good", "https://attacker.example"),
    )).status === 403,
  );
});
Deno.test("announcement input boundaries, pagination and explicit send confirmation", async () => {
  let data: Record<string, unknown> = {};
  const handle = createAdminPushHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async (_, value) => {
      data = value;
      return {};
    },
  });
  for (
    const body of [
      { action: "history", page: 0 },
      { action: "users", filters: [] },
      { action: "send", campaignId: "invalid" },
      { action: "preview", filters: {}, titleEn: 3 },
    ]
  ) assert((await handle(request(body))).status === 400);
  assert(
    (await handle(
      request({ action: "preview", filters: {}, bodyEn: "x".repeat(66000) }),
    )).status === 413,
  );
  assert(
    (await handle(
      request({
        action: "send",
        campaignId: identity.user_id,
        confirmed: "true",
      }),
    )).status === 200,
  );
  assert(data.confirmed === false);
  const expired = createAdminPushHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async () => {
      throw Error("PREVIEW_EXPIRED");
    },
  });
  const r = await expired(request({ action: "history" }));
  assert(r.status === 400 && (await r.json()).error === "PREVIEW_EXPIRED");
});
Deno.test("phase2 lifecycle and saved audience requests remain identity-bound and validate input", async () => {
  let data: Record<string, unknown> = {};
  const handle = createAdminPushHandler({
    ...runtime,
    authenticate: async () => identity,
    rpc: async (_, value) => {
      data = value;
      return {};
    },
  });
  for (const action of ["duplicate", "cancel"]) {
    assert(
      (await handle(request({ action, campaignId: "invalid" }))).status === 400,
    );
    assert(
      (await handle(
        request({
          action,
          campaignId: identity.user_id,
          confirmed: true,
          user_id: "forged",
        }),
      )).status === 200,
    );
    assert(data.user_id === identity.user_id);
  }
  assert(
    (await handle(request({ action: "cancel", campaignId: identity.user_id })))
      .status === 200,
  );
  assert(data.confirmed === false);
  for (
    const body of [
      { action: "deleteAudience", audienceId: "bad" },
      { action: "saveAudience", name: "", filters: {} },
      { action: "saveAudience", name: "x", filters: [] },
      { action: "barbers", query: "x".repeat(121) },
      { action: "preview", filters: {}, scheduledAt: 123 },
    ]
  ) assert((await handle(request(body))).status === 400);
  assert(
    (await handle(
      request({
        action: "saveAudience",
        name: "Returning",
        filters: { minCompleted: 2 },
      }),
    )).status === 200,
  );
  assert(data.name === "Returning" && !("mode" in data));
});
