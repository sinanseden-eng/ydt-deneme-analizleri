# Cloudflare R2 Setup Guide

This guide connects the YDT analyzer to a private Cloudflare R2 bucket. The
website remains hosted on Netlify.

## Before starting

You need:

- the production Netlify URL, such as `https://your-site.netlify.app`
- a Cloudflare account with R2 enabled
- a Gemini API key from Google AI Studio

Do not paste secret keys into GitHub, browser code, screenshots, or support
messages. They belong only in Netlify environment variables.

## Replacing the earlier Supabase file set

Before uploading this R2 version, delete these obsolete repository files:

- `netlify/functions/_shared/supabase.js`
- `supabase/migrations/202608300001_ydt_analysis.sql`

The `supabase` folder will disappear when its final file is deleted. Upload all
files from the R2 package and allow GitHub to replace existing files with the
same names, especially `index.html`, `package.json`, and `package-lock.json`.

## 1. Create the private R2 bucket

1. Sign in to the Cloudflare dashboard.
2. Open **Storage & databases > R2 Object Storage**.
3. Select **Create bucket**.
4. Use the bucket name `ydt-uploads`.
5. Choose **Standard** storage if Cloudflare asks for a storage class.
6. Create the bucket.

Keep **Public Development URL** and custom public-domain access disabled. The
application uses temporary signed upload URLs; the bucket itself stays private.

## 2. Configure browser-upload CORS

Open the `ydt-uploads` bucket, choose **Settings**, find **CORS Policy**, and
add this policy. Replace the example origin with the exact production URL of
your Netlify site. Do not add a trailing slash.

```json
[
  {
    "AllowedOrigins": [
      "https://YOUR-SITE.netlify.app"
    ],
    "AllowedMethods": [
      "PUT"
    ],
    "AllowedHeaders": [
      "Content-Type"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

If the site also uses a custom domain, add it as a second `AllowedOrigins`
entry. Keep origins exact rather than using `*`.

For optional local testing, you may temporarily add
`http://localhost:8888`. Remove it when local testing is finished.

## 3. Create a bucket-limited R2 API token

1. Return to **R2 Object Storage**.
2. Open **Manage R2 API Tokens**.
3. Choose **Create API token**.
4. Give it a recognizable name such as `ydt-netlify-production`.
5. Select **Object Read & Write** permission.
6. Restrict access to the `ydt-uploads` bucket only.
7. Create the token.

Copy these values while Cloudflare displays them:

- Account ID
- Access Key ID
- Secret Access Key

The secret may only be displayed once. If it is lost, revoke the token and
create a replacement; do not widen an existing token's permissions.

## 4. Add environment variables in Netlify

In Netlify, open the YDT project and go to **Project configuration >
Environment variables**. Add:

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | Token Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Token Secret Access Key |
| `R2_BUCKET_NAME` | `ydt-uploads` |
| `GEMINI_API_KEY` | Your Gemini API key |
| `GEMINI_MODEL` | `gemini-3.7-flash` |
| `APP_ACCESS_CODE` | A private code chosen by the teacher |

You do not need `R2_ENDPOINT` for a standard R2 account. If Cloudflare supplies
a jurisdiction-specific endpoint, add it as `R2_ENDPOINT` exactly as shown in
the R2 API-token screen.

Delete old `SUPABASE_*` variables from this Netlify project after the R2
version is working. They are ignored by version 3, but removing unused secrets
is good housekeeping.

## 5. Deploy the R2 version

1. Confirm the new files are on the repository's default branch.
2. In Netlify, open **Deploys**.
3. Choose **Trigger deploy > Clear cache and deploy site**.
4. Wait for the production deployment to finish.
5. Open **Functions** and confirm these functions appear:
   - `create-job`
   - `analyze-background`
   - `job-status`
   - `cleanup-scheduled`

The `analyze-background` function is intentionally asynchronous. The browser
polls `job-status` while it runs.

## 6. Run the first controlled test

1. Open the production Netlify URL.
2. Enter the `APP_ACCESS_CODE` value.
3. Start with a small, known YDT PDF.
4. Optionally attach an XLSX or CSV key.
5. Confirm that the upload reaches 100% and analysis progress begins.
6. Confirm that the result reports question coverage and a difficulty band.

After the first analysis, the R2 bucket may briefly show these prefixes:

- `uploads/` for temporary source files
- `jobs/` for private status/result JSON
- `locks/` while a background job owns the analysis

The PDF and answer-key objects should disappear when processing finishes. The
job JSON remains for up to 30 days so a refreshed browser can retrieve its
result. The browser keeps its own derived-result archive locally.

## Troubleshooting

### Upload fails with an R2 or CORS message

- Confirm the Netlify production origin exactly matches `AllowedOrigins`.
- Confirm there is no trailing slash in the CORS origin.
- Confirm `PUT` and `Content-Type` are allowed.
- Confirm the R2 token has Object Read & Write permission for `ydt-uploads`.
- After changing CORS, wait briefly and retry with a newly created analysis.

### `Analiz işi başlatılamadı` appears immediately

- Check that all `R2_*` variables exist in Netlify.
- Check that the Account ID, Access Key ID, and Secret Access Key were not
  accidentally exchanged.
- Trigger a new deployment after changing environment variables.

### Upload succeeds but analysis fails

- Check `GEMINI_API_KEY` and `GEMINI_MODEL` in Netlify.
- Confirm the PDF is valid and no larger than 50 MB.
- Check the `analyze-background` function log without copying secrets into a
  public issue.

### Functions are missing

- Confirm `netlify.toml` is in the repository root.
- Confirm the files are under `netlify/functions/`.
- Redeploy with the build cache cleared.

## Security and retention summary

- R2 remains private.
- Browser upload URLs expire after 15 minutes and point to random job paths.
- R2 API credentials never reach the browser.
- Client job tokens are stored only as SHA-256 hashes in R2.
- PDF content is validated before analysis.
- Source files are deleted after success or failure.
- Abandoned uploads are deleted after 24 hours.
- Derived job records are deleted after 30 days.
- Gemini and R2 keys are used only in server-side Netlify functions.
