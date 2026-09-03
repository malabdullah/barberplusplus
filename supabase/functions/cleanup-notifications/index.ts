import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.89.0";
import { hasValidSharedSecret } from "../_shared/environment.ts";

const RETENTION_DAYS = 30;
const BATCH_SIZE = 1000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!(await hasValidSharedSecret(req))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing environment variables");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Calculate cutoff date (30 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    let totalDeleted = 0;
    let batchDeleted = 0;

    // Delete in batches to avoid timeouts and reduce database strain
    do {
      const { data, error } = await supabase
        .from("notifications")
        .delete()
        .lt("created_at", cutoffDate.toISOString())
        .limit(BATCH_SIZE)
        .select("id");

      if (error) {
        throw error;
      }

      batchDeleted = data?.length || 0;
      totalDeleted += batchDeleted;

      // Small delay between batches to reduce database load
      if (batchDeleted === BATCH_SIZE) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } while (batchDeleted === BATCH_SIZE);

    const result = {
      success: true,
      deleted: totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
      retentionDays: RETENTION_DAYS,
      timestamp: new Date().toISOString(),
    };

    console.log("Notification cleanup completed:", result);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Notification cleanup failed:", errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
