import { customerRuntime } from "../_shared/customer-runtime.ts";
type Data = Record<string, unknown>;
type Identity = {
  user_id: string;
  session_id: string;
  role: string;
  aal: string;
};
type Dependencies = Parameters<typeof customerRuntime>[0] & {
  authenticate: (token: string) => Promise<Identity | null>;
  rpc: (action: string, data: Data) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function createAccountToolsHandler(deps: Dependencies) {
  const runtime = customerRuntime(deps);
  return async (request: Request) => {
    const allowed = await runtime.allows(request);
    const headers = {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowed && request.headers.get("origin")
        ? request.headers.get("origin")!
        : deps.appUrl,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };
    const reply = (status: number, value: unknown) =>
      Response.json(value, { status, headers });
    if (!runtime.enabled) return reply(404, { error: "NOT_AVAILABLE" });
    if (!allowed) return reply(403, { error: "FORBIDDEN" });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return reply(405, { error: "INVALID_REQUEST" });
    }
    try {
      const token =
        request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
      const identity = token ? await deps.authenticate(token) : null;
      if (!identity) return reply(401, { error: "AUTH_REQUIRED" });
      if (
        !["admin", "manager", "barber", "customer", "agent"].includes(
          identity.role,
        )
      ) return reply(403, { error: "FORBIDDEN" });
      if (identity.role === "admin" && identity.aal !== "aal2") {
        return reply(403, { error: "ADMIN_MFA_REQUIRED" });
      }
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { error: "INVALID_REQUEST" });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
          await reader.cancel();
          return reply(413, { error: "INVALID_REQUEST" });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const value of chunks) {
        bytes.set(value, offset);
        offset += value.length;
      }
      let body: Data;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return reply(400, { error: "INVALID_REQUEST" });
      }
      if (
        !body || Array.isArray(body) ||
        !["status", "sessions", "revoke-session", "activity"].includes(
          String(body.action),
        )
      ) return reply(400, { error: "INVALID_REQUEST" });
      const data: Data = {
        user_id: identity.user_id,
        session_id: identity.session_id,
        aal: identity.aal,
      };
      if (body.action === "revoke-session") {
        if (!uuid.test(String(body.targetId))) {
          return reply(400, { error: "INVALID_REQUEST" });
        }
        data.targetId = body.targetId;
      } else if (body.action === "activity") {
        if (!["customer", "work"].includes(String(body.view))) {
          return reply(400, { error: "INVALID_REQUEST" });
        }
        data.view = body.view;
        if (body.cursor != null) {
          if (!/^[1-9][0-9]{0,18}$/.test(String(body.cursor))) {
            return reply(400, { error: "INVALID_REQUEST" });
          }
          data.cursor = String(body.cursor);
        }
      } else if (body.cursor != null) {
        const cursor = body.cursor as Data;
        if (
          typeof cursor !== "object" || Array.isArray(cursor) ||
          !uuid.test(String(cursor.id)) ||
          typeof cursor.createdAt !== "string" ||
          cursor.createdAt.length > 40 ||
          !Number.isFinite(Date.parse(cursor.createdAt))
        ) return reply(400, { error: "INVALID_REQUEST" });
        data.cursor = { id: cursor.id, createdAt: cursor.createdAt };
      }
      return reply(200, await deps.rpc(String(body.action), data));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const name = [
        "AUTH_REQUIRED",
        "ADMIN_MFA_REQUIRED",
        "FORBIDDEN",
        "INVALID_REQUEST",
        "SESSION_NOT_FOUND",
        "USE_SIGN_OUT_FOR_CURRENT_SESSION",
      ].find((value) => message.includes(value));
      return reply(
        name === "AUTH_REQUIRED"
          ? 401
          : name === "ADMIN_MFA_REQUIRED" || name === "FORBIDDEN"
          ? 403
          : name
          ? 400
          : 503,
        { error: name || "UNAVAILABLE" },
      );
    }
  };
}
