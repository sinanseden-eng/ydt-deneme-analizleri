"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  bodyToBuffer,
  createUploadUrl,
  hashClientToken,
  jobObjectKey,
  lockObjectKey,
  verifyClientToken,
} = require("../netlify/functions/_shared/r2");

test("R2 job tokens are stored as hashes and verified safely", () => {
  const token = "550e8400-e29b-41d4-a716-446655440000";
  const job = { client_token_hash: hashClientToken(token) };
  assert.notEqual(job.client_token_hash, token);
  assert.equal(verifyClientToken(job, token), true);
  assert.equal(verifyClientToken(job, "wrong-token"), false);
});

test("R2 object paths isolate jobs and locks", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(jobObjectKey(id), `jobs/${id}.json`);
  assert.equal(lockObjectKey(id), `locks/${id}.lock`);
});

test("R2 response streams are converted to buffers", async () => {
  const buffer = await bodyToBuffer(Readable.from([Buffer.from("YDT "), Buffer.from("test") ]));
  assert.equal(buffer.toString("utf8"), "YDT test");
});

test("R2 upload links are private signatures that expire after 15 minutes", async () => {
  process.env.R2_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET_NAME = "ydt-uploads";
  const signed = new URL(await createUploadUrl("uploads/job/exam.pdf", "application/pdf"));
  assert.equal(
    signed.hostname,
    `${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  );
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "900");
  assert.ok(signed.searchParams.get("X-Amz-Signature"));
});
