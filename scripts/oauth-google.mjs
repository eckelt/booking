#!/usr/bin/env node
// One-time helper: get a Google refresh token for creating Meet links.
//
//   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node scripts/oauth-google.mjs
//
// Opens a consent screen for the owner's Google account, then prints the
// refresh token to store as the GOOGLE_REFRESH_TOKEN worker secret.
// Setup of the OAuth client: docs/video-providers.md.
import { createServer } from "node:http";

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/meetings.space.created";
const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, LOGIN_HINT: hint = "nilseckelt@googlemail.com" } = process.env;
if (!id || !secret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.search = new URLSearchParams({
  client_id: id,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
  login_hint: hint,
}).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.end(`Error: ${url.searchParams.get("error")}`);
    return finish(1);
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    res.end("No refresh token received — see the terminal.");
    console.error(data);
    return finish(1);
  }
  res.end("Done — you can close this tab.");
  console.log("\nGOOGLE_REFRESH_TOKEN:\n" + data.refresh_token);
  console.log("\nStore it with:  cd worker && npx wrangler secret put GOOGLE_REFRESH_TOKEN");
  finish(0);
});

function finish(code) {
  server.close();
  process.exit(code);
}

server.listen(PORT, () => console.log(`Open this URL and sign in as ${hint}:\n\n${auth}\n`));
