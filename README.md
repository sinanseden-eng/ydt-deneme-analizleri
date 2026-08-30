# YDT Difficulty Analyzer

A Netlify-hosted YDT analysis dashboard that uploads PDFs directly to private
Supabase Storage, analyses them with Gemini, and calibrates the result against
the 2022-2026 ÖSYM YDT reference set.

## What changed in version 2

- PDFs up to 50 MB no longer pass through Netlify's request body.
- Uploads use short-lived, path-specific Supabase tokens.
- Analysis runs as a Netlify Background Function.
- Uploaded PDFs and answer keys are deleted after processing.
- A daily cleanup removes abandoned uploads after 24 hours and old job records after 30 days.
- XLSX and CSV answer keys are supported.
- Every result reports question and answer coverage.
- Completeness is derived from 80 unique question-audit records, rather than a model-reported total.
- Difficulty uses fixed, auditable educational weights.
- The result is labelled as predicted difficulty, not observed student difficulty.

## 1. Supabase setup

Create a Supabase project, open **SQL Editor**, and run:

`supabase/migrations/202608300001_ydt_analysis.sql`

This creates a private `ydt-uploads` bucket and a service-only
`analysis_jobs` table. Do not add public policies to either resource.

## 2. Netlify environment variables

Add these variables in **Project configuration > Environment variables**:

| Variable | Value |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-3.7-flash` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; never expose it in the browser |
| `SUPABASE_STORAGE_BUCKET` | `ydt-uploads` |
| `APP_ACCESS_CODE` | A private teacher access code for controlling API costs |

After saving variables, trigger a new Netlify deployment.

## 3. Local checks

```sh
npm install
npm test
```

The static interface is `index.html`. Netlify functions are under
`netlify/functions/`.

## Analysis method

The server calculates the final score from six Gemini-derived dimensions:

- vocabulary: 20%
- grammar and syntax: 15%
- reading and inference: 25%
- question skills: 15%
- distractor quality: 20%
- time pressure: 5%

Bands are `Kolay` below 55, `Orta` from 55 to 60, `Orta-zor` from 61 to 67,
and `Zor` from 68 upward. The current anchors are ÖSYM 2022 (55), 2023 (57),
2024 (61), 2025 (69), and 2026 (58).

The application stores derived results, not reproduced question content.
