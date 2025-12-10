// api/oauth/callback.js
export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("Missing code from Google OAuth");
    }

    const BASE_URL = process.env.BASE_URL;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!BASE_URL || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).send("Missing environment variables");
    }

    // Decode agent_code from state
    const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    const agent_code = decoded.agent_code;

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${BASE_URL}/api/oauth/callback`
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("Token exchange error:", tokenData);
      return res.status(400).send("Token exchange failed");
    }

    const { access_token, refresh_token, expires_in, scope } = tokenData;
    const token_expiry = new Date(Date.now() + expires_in * 1000).toISOString();

    // Get user info
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userInfo = await userInfoRes.json();
    const google_id = userInfo.sub;
    const user_email = userInfo.email;

    // Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Upsert agent
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .upsert(
        {
          agent_code,
          email: user_email,
          last_seen: new Date().toISOString()
        },
        { onConflict: "agent_code" }
      )
      .select()
      .single();

    if (agentErr) throw agentErr;

    // Upsert tokens
    const { error: tokenErr } = await supabase
      .from("google_tokens")
      .upsert(
        {
          agent_id: agentRow.id,
          google_id,
          access_token,
          refresh_token,
          scope,
          token_expiry
        },
        { onConflict: "agent_id" }
      );

    if (tokenErr) throw tokenErr;

    res.setHeader("content-type", "text/html");
    return res.status(200).send(`
      <h2>Installation Complete ✅</h2>
      <p>Agent ID: <strong>${agentRow.agent_code}</strong></p>
      <p>Google account linked: <strong>${user_email}</strong></p>
    `);
  } catch (err) {
    console.error("Callback error:", err);
    return res.status(500).send("OAuth callback failed");
  }
}
