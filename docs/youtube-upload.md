# Uploading to YouTube

The Studio's **Upload** page sends `video/out/final.mp4` to your YouTube channel with the title and thumbnail you picked and the description and settings you checked. It uses the YouTube Data API v3 with **your own** Google Cloud OAuth client, so nothing goes through anyone else's servers and no one else's app has access to your channel.

- It uploads **only when you press Upload to YouTube**, and asks once more. Agents never upload; the route refuses anything that does not come from the Studio page itself.
- Videos go up as **Private** unless you choose Unlisted or Public. You can also schedule a private video to go public at a set time.
- **Dry run** goes through every step against a fake YouTube on your computer and lists each request in `studio/upload-dry.json`. Nothing leaves your machine. Use it to check before the first real upload.
- Uploads are resumable: the file goes in 8 MB pieces, a dropped connection is retried, and pressing Upload again after a failure continues where it stopped (for up to six days).

You do this setup once. It takes about ten minutes.

## 1. Make a Google Cloud project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that owns (or manages) your YouTube channel.
2. At the top, open the project picker and choose **New project**. Name it anything, for example `my-studio`. Create it and make sure it is selected.

## 2. Turn on the YouTube Data API v3

1. Go to **APIs & Services → Library**.
2. Search for **YouTube Data API v3**, open it and press **Enable**.

## 3. Set up the consent screen

Google calls this the OAuth consent screen (in newer consoles: **Google Auth Platform → Branding / Audience / Data access**).

1. **User type / Audience: External.** (Internal is only for Workspace organisations.)
2. App name: anything you like (only you will see it). Support email and developer email: your own.
3. **Data access / Scopes**: add `https://www.googleapis.com/auth/youtube.upload` (search "youtube.upload"). It is the only scope the Studio asks for: it can upload videos and set their thumbnails, nothing else.
4. **Audience → Test users**: add your own Google account (the one with the channel). While the app is in "Testing", only test users can connect.

You do not need to publish or verify the app for your own use. Two things to know about an app in Testing:

- **Your connection lasts 7 days.** After that, press **Connect YouTube** again (the Studio tells you when it is needed). To avoid this, set the app to **In production** under Audience; Google then shows an "unverified app" warning on the sign-in page, which you can pass for your own app ("Advanced → Go to …").
- **Videos uploaded through an unverified API project may be locked to private** by YouTube until the project passes an audit. Private is the Studio's default anyway: after uploading, change the visibility in YouTube Studio. If you want uploads to go public directly, request an audit through YouTube's API Services audit form.

## 4. Make the OAuth client

1. Go to **APIs & Services → Credentials** (or **Google Auth Platform → Clients**).
2. **Create credentials → OAuth client ID**.
3. Application type: **Desktop app**. Name: anything.
4. Create it, then press **Download JSON**.
5. Save that file as **`data/youtube-client.json`** in the app folder (the `data/` folder is never committed to git).

Instead of the file you can set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in the environment before starting the app.

A Desktop client lets the sign-in come back to `http://127.0.0.1:<port>/api/studio/youtube/callback` on whatever port the app runs on; you do not need to enter a redirect address. (A **Web application** client also works if you add that exact address, with your port, under Authorised redirect URIs.)

## 5. Connect

1. Open the Studio's **Upload** page and press **Connect YouTube**.
2. A Google sign-in tab opens. Choose the account, then the channel if it asks (a brand account channel is chosen here), and allow "Manage your YouTube videos" (upload).
3. The tab says "YouTube is connected". Close it.

The app stores the tokens in **`data/youtube-token.json`** (gitignored). **Disconnect** deletes it. You can also remove the app's access at <https://myaccount.google.com/permissions>.

## 6. Upload

1. Pick a title (Titles page) and a thumbnail (Thumbnails page), or a package on the Feed page.
2. Check the description, tags, visibility, category and audience on the Upload page. "Made for kids" is your legal answer for your audience; the app never sets it for you. Tick "Altered or synthetic content" if the video shows realistic AI-made people, places or events.
3. Press **Dry run** once, then **Upload to YouTube**.
4. When it is done you get the video's link and a link to edit it in YouTube Studio.

## Limits and errors

- **Quota.** Every project gets a daily quota of API units (10,000 by default). An upload costs a large share of it (check the current cost in Google's quota calculator), so a handful of uploads a day is the practical limit. "quotaExceeded" means: wait until the next day (Pacific time) or request more quota in the console.
- **Custom thumbnails** need a channel verified by phone (<https://www.youtube.com/verify>). Without it the video still uploads and the Studio says the thumbnail was refused. Thumbnails over 2 MB are turned into JPEG first.
- **Title**: at most 100 characters, no `<` or `>`. **Description**: at most 5000 bytes, no `<` or `>`. **Tags**: 500 characters together. The Studio checks these before it sends anything.
- **"access_denied"** at sign-in: your account is not on the test users list (step 3.4).
- **"invalid_grant"** when uploading: the connection expired (7 days in Testing) or was removed. Press Connect YouTube again.
- **Upload stopped (5xx / network)**: press Upload again; it resumes from the last piece YouTube received.

## For testing without a channel

Set `PRESENCE_UPLOAD_DRY=1` before starting the server and every upload becomes a dry run. The tests (`server/studio/upload.test.js`) use the same fake YouTube.
