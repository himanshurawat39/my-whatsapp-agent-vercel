// api/oauth/start.js
export const config = { runtime: "nodejs" };

const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    const { agent_code } = req.query;
    const BASE_URL = process.env.BASE_URL;
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

    if (!BASE_URL || !GOOGLE_CLIENT_ID) {
      return res.status(500).send('Missing BASE_URL or GOOGLE_CLIENT_ID');
    }

    // If no agent_code is provided, generate one (mainly for testing)
    const code = agent_code || `AGT_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Pack agent_code into state to retrieve it later in callback
    const statePayload = { agent_code: code, nonce: crypto.randomBytes(8).toString('hex') };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64');

    const redirectUri = `${BASE_URL}/api/oauth/callback`;

    const scope = [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ].join(' ');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
  } catch (err) {
    console.error('OAuth start error:', err);
    res.status(500).send('OAuth start failed');
  }
};
