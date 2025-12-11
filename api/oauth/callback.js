export const config = { runtime: "nodejs" };

const { createClient } = require("@supabase/supabase-js");
const fetch = require("node-fetch");

module.exports = async function (req, res) {
  try {
    const { code, state } = req.query;

    if (!code) return res.status(400).send("Missing code");

    const BASE_URL = process.env.BASE_URL;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const decoded = JSON.parse(Buffer.from(state, "base64").toString());
    const agent_code = decoded.agent_code;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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

    const token = await tokenRes.json();
    if (token.error) throw token;

    const token_expiry = new Date(Date.now() + token.expires_in * 1000).toISOString();

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    const userInfo = await userInfoRes.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // FIXED UPSERT — the correct syntax
    const { data: agentRow, error: agentErr } = await supabase
      .from("agents")
      .upsert(
        {
          agent_code,
          email: userInfo.email,
          last_seen: new Date().toISOString()
        },
        { onConflict: "agent_code" }
      )
      .select()
      .single();

    if (agentErr) throw agentErr;

    const { error: tokenErr } = await supabase
      .from("google_tokens")
      .upsert(
        {
          agent_id: agentRow.id,
          google_id: userInfo.sub,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          scope: token.scope,
          token_expiry
        },
        { onConflict: "agent_id" }
      );

    if (tokenErr) throw tokenErr;

    res.status(200).send(`
      <h2>Installation Complete</h2>
      <p>Agent: ${agentRow.agent_code}</p>
      <p>Email: ${userInfo.email}</p>
    `);

  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("OAuth callback failed");
  }
};
