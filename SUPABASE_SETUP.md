# G-Tube Supabase setup

G-Tube uses username + six-digit PIN profiles. YouTube Data API requests are sent through the \`galaxy-api\` Edge Function so the YouTube API key is not shipped to the browser.

## 1. Create the database tables

Open your Supabase project, go to **SQL Editor**, and run the complete contents of \`supabase/setup.sql\`.

The tables have Row Level Security enabled and direct access is revoked from \`anon\` and \`authenticated\`. The Edge Function uses the server-side service-role key to access them.

## 2. Configure Edge Function secrets

Enable **YouTube Data API v3** in Google Cloud and create an API key. Do not put that key in this repository.

Install the Supabase CLI and link this repository to your project, then set:

\`\`\`sh
supabase secrets set YOUTUBE_API_KEY="your-youtube-data-api-key" PIN_PEPPER="a-long-random-secret-string"
supabase functions deploy galaxy-api
\`\`\`

Supabase supplies \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\` to Edge Functions automatically. Never put the service-role key in frontend code or commit it to GitHub.

Use a long random \`PIN_PEPPER\`; it must remain private. A six-digit PIN is only basic protection, so do not reuse an important PIN.

## 3. Configure the browser client

Open \`galaxy-client.js\` and replace:

- \`PASTE_SUPABASE_PROJECT_URL_HERE\` with the project URL, such as \`https://abcdefgh.supabase.co\`.
- \`PASTE_SUPABASE_ANON_KEY_HERE\` with the project's public anon/publishable key.

The anon key is expected to be public. Database RLS and the Edge Function enforce the access boundary. Never use the service-role key here.

## 4. Test

1. Wait for jsDelivr to refresh the files.
2. Open G-Tube and click **Create profile**.
3. Choose a username of 3–24 lowercase letters, digits, underscores, or hyphens, and a six-digit PIN.
4. Sign out, then use **Sign in** to test the profile.
5. Search for a video and test the watch page. Likes and Watch Later are saved to the Supabase profile.

## Notes

- Google OAuth has been removed.
- The API key is never sent to the browser; the Edge Function adds it to YouTube Data API requests.
- Since YouTube account OAuth is removed, G-Tube cannot read a user's private subscriptions. The homepage uses public YouTube search results instead.
- Username + PIN is a custom basic-login system, not email-verified identity. The Edge Function limits repeated login attempts per username, but users should avoid choosing a PIN they use elsewhere.
- The Edge Function currently proxies the public YouTube endpoints \`search\`, \`videos\`, \`channels\`, and \`playlistItems\`.