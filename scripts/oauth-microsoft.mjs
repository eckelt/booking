#!/usr/bin/env node
// One-time helper: get a Microsoft refresh token for creating Teams links.
//
//   MS_CLIENT_ID=… [MS_CLIENT_SECRET=…] [MS_TENANT_ID=…] node scripts/oauth-microsoft.mjs
//
// Opens a consent screen for the owner's Microsoft 365 (work/school) account,
// then prints the refresh token to store as the MS_REFRESH_TOKEN worker secret.
// Setup of the Entra app registration: docs/video-providers.md.
import { createServer } from "node:http";

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = "OnlineMeetings.ReadWrite offline_access";
const {
  MS_CLIENT_ID: id,
  MS_CLIENT_SECRET: secret,
  MS_TENANT_ID: tenant = "common",
  LOGIN_HINT: hint = "nils@ecke.lt",
} = process.env;
if (!id) {
  console.error("Set MS_CLIENT_ID first (and MS_CLIENT_SECRET for a web-platform app).");
  process.exit(1);
}
const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

const auth = new URL(`${base}/authorize`);
auth.search = new URLSearchParams({
  client_id: id,
  redirect_uri: REDIRECT,
  response_type: "code",
  response_mode: "query",
  scope: SCOPE,
  prompt: "consent",
  login_hint: hint,
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.end(`Error: ${url.searchParams.get("error")} ${url.searchParams.get("error_description") ?? ""}`);
    return finish(1);
  }
  const tokenRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      ...(secret ? { client_secret: secret } : {}),
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
      scope: SCOPE,
    }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    res.end("No refresh token received — see the terminal.");
    console.error(data);
    return finish(1);
  }
  res.end("Done — you can close this tab.");
  console.log("\nMS_REFRESH_TOKEN:\n" + data.refresh_token);
  console.log("\nStore it with:  cd worker && npx wrangler secret put MS_REFRESH_TOKEN");
  finish(0);
});

function finish(code) {
  server.close();
  process.exit(code);
}

server.listen(PORT, () => console.log(`Open this URL and sign in as ${hint}:\n\n${auth}\n`));
