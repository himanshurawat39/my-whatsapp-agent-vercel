// api/oauth/callback.js
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send('Missing code from Google OAuth');
    }

    const BASE_URL = process.env.BASE_URL;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!BASE_URL || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).send('Missing environment variables');
    }

    // Decode agent_code from state
    let agent_code = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      agent_code = decoded.agent_code;
    } catch (err) {
      console.log('State decode failed');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${BASE_URL}/api/oauth/callback`
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      return res.status(400).send('Token exchange failed');
    }

    const { access_token, refresh_token, expires_in, scope } = tokenData;
    const token_expiry = new Date(Date.now() + expires_in * 1000).toISOString();

    // Get user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userInfo = await userInfoRes.json();
    const google_id = userInfo.sub;
    const user_email = userInfo.email;

    // Connect to Supabase (server-side key)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Ensure agent exists
    let agentRow = null;

    const { data: existingAgent } = await supabase
      .from('agents')
      .select('*')
      .eq('agent_code', agent_code)
      .limit(1);

    if (existingAgent && existingAgent.length > 0) {
      agentRow = existingAgent[0];
    } else {
      // Create new agent row if none exists
      const { data: newAgent, error: agentErr } = await supabase
        .from('agents')
        .insert({ agent_code, email: user_email })
        .select('*')
        .single();

      if (agentErr) throw agentErr;
      agentRow = newAgent;
    }

    // Upsert Google token record
    const { error: tokenErr } = await supabase
      .from('google_tokens')
      .upsert({
        agent_id: agentRow.id,
        google_id,
        access_token,
        refresh_token,
        scope,
        token_expiry
      }, { onConflict: ['agent_id'] });

    if (tokenErr) throw tokenErr;

    // Return success HTML
    res.setHeader('content-type', 'text/html');
    res.status(200).send(`
      <h2>Installation Complete ✅</h2>
      <p>Agent ID: <strong>${agentRow.agent_code}</strong></p>
      <p>Google account linked: <strong>${user_email}</strong></p>
      <p>You may now close this tab.</p>
    `);

  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send('OAuth callback failed');
  }
};
