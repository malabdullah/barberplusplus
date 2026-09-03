import "jsr:@supabase/functions-js@2.89.0/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { getAppUrl, getTrustedRole } from "../_shared/environment.ts";

// SECURITY: Request size limit to prevent abuse
const MAX_REQUEST_SIZE = 10 * 1024; // 10KB max for invite requests

const corsHeaders = {
  "Access-Control-Allow-Origin": getAppUrl(),
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // SECURITY: Check request size limit
  const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (contentLength > MAX_REQUEST_SIZE) {
    return new Response(
      JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Verify JWT from request (ensures caller is authenticated)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the caller's JWT and get user info
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is a manager
    if (getTrustedRole(caller) !== "manager") {
      return new Response(
        JSON.stringify({ error: "Only managers can invite barbers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { barberId, email, name, branchId, isResend } = await req.json();

    if (!barberId || !email || !branchId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: barberId, email, branchId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SECURITY: Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(barberId) || !uuidRegex.test(branchId)) {
      return new Response(
        JSON.stringify({ error: "Invalid ID format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The service-role client bypasses RLS, so establish manager ownership and
    // barber membership explicitly before performing any privileged mutation.
    const { data: ownedBranch } = await supabaseAdmin
      .from("branches")
      .select("id")
      .eq("id", branchId)
      .eq("manager_id", caller.id)
      .maybeSingle();
    const { data: barberAssignment } = await supabaseAdmin
      .from("barbers")
      .select("id, user_id, invite_status")
      .eq("id", barberId)
      .eq("branch_id", branchId)
      .maybeSingle();

    if (!ownedBranch || !barberAssignment) {
      return new Response(
        JSON.stringify({ error: "Barber assignment is outside your managed branch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isResend && barberAssignment.user_id) {
      const { data: assignedUser, error: assignedUserError } =
        await supabaseAdmin.auth.admin.getUserById(barberAssignment.user_id);
      const canReplaceInvite = !assignedUserError
        && assignedUser.user?.email?.toLowerCase() === email.toLowerCase()
        && ["pending", "sent"].includes(barberAssignment.invite_status);

      if (!canReplaceInvite) {
        return new Response(
          JSON.stringify({ error: "The existing account is not a replaceable pending invite" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(barberAssignment.user_id);
      if (deleteError) {
        console.error("Delete user error:", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to reset invite. Please try again." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (barberAssignment.user_id) {
      return new Response(
        JSON.stringify({ error: "This barber already has an assigned account" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const redirectUrl = `${getAppUrl()}/accept-invite`;

    // Send invite via Supabase Admin API
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          name: name,
        },
        redirectTo: redirectUrl,
      }
    );

    if (inviteError) {
      console.error("Invite error:", inviteError);
      return new Response(
        JSON.stringify({ error: inviteError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(
      inviteData.user.id,
      { app_metadata: { role: "barber" } },
    );
    if (metadataError) {
      await supabaseAdmin.auth.admin.deleteUser(inviteData.user.id);
      console.error("Trusted role assignment failed:", metadataError);
      return new Response(
        JSON.stringify({ error: "Failed to assign the invited account role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update barber record with auth user_id and invite status
    const { error: updateError } = await supabaseAdmin
      .from("barbers")
      .update({
        user_id: inviteData.user.id,
        invite_status: "sent",
        invite_sent_at: new Date().toISOString(),
      })
      .eq("id", barberId);

    if (updateError) {
      console.error("Update error:", updateError);
      await supabaseAdmin.auth.admin.deleteUser(inviteData.user.id);
      return new Response(
        JSON.stringify({ error: "Failed to attach the invited account to the barber" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: inviteData.user.id,
        message: isResend ? "Invite resent successfully" : "Invite sent successfully"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
