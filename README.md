# YDT Difficulty Analyzer

A Netlify-hosted YDT analysis dashboard using private Cloudflare R2 storage and
Gemini native PDF analysis. Results are calibrated against the 2022-2026 ÖSYM
YDT reference set.

## Architecture

1. A Netlify function validates the request and creates a 15-minute R2 upload URL.
2. The browser uploads the PDF directly to a private R2 bucket (maximum 50 MB).
3. A Netlify Background Function reads the PDF from R2 and sends it to Gemini.
4. R2 stores a small private JSON job record containing progress and the derived result.
5. The source PDF and optional answer key are deleted immediately after processing.
6. A daily cleanup deletes abandoned uploads after 24 hours and job records after 30 days.

No Supabase project or public storage bucket is required.

## Setup

Follow [R2_SETUP.md](R2_SETUP.md) for the complete Cloudflare and Netlify setup.

Required Netlify environment variables:

| Variable | Purpose |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Bucket-limited R2 access key |
| `R2_SECRET_ACCESS_KEY` | Bucket-limited R2 secret key |
| `R2_BUCKET_NAME` | `ydt-uploads` |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-3.7-flash` |
| `APP_ACCESS_CODE` | Private teacher access code |

Never commit real keys to GitHub. `.env.example` contains names only.

## Local checks

```sh
npm install
npm test
```

The static interface is `index.html`. Netlify functions are under
`netlify/functions/`.

## Analysis method

The final predicted-difficulty score uses six fixed dimensions:

- vocabulary and CEFR: 20%
- grammar and syntax: 15%
- reading and inference: 25%
- question skills: 15%
- distractor quality: 20%
- time pressure: 5%

Bands are `Kolay` below 55, `Orta` from 55 to 60, `Orta-zor` from 61 to 67,
and `Zor` from 68 upward. Anchors are ÖSYM 2022 (55), 2023 (57), 2024 (61),
2025 (69), and 2026 (58).

Completeness is calculated from 80 unique question-audit records. The stored
report contains derived measurements, not reproduced question text.
