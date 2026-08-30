"use strict";

const crypto = require("node:crypto");
const {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

let cachedClient;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Eksik sunucu ayarı: ${name}`);
  return value;
}

function getBucket() {
  return process.env.R2_BUCKET_NAME || "ydt-uploads";
}

function getR2Client() {
  if (!cachedClient) {
    const accountId = requireEnv("R2_ACCOUNT_ID");
    cachedClient = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return cachedClient;
}

function hashClientToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function verifyClientToken(job, value) {
  const actual = Buffer.from(hashClientToken(value), "hex");
  const expected = Buffer.from(String(job?.client_token_hash || ""), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function jobObjectKey(jobId) {
  return `jobs/${jobId}.json`;
}

function lockObjectKey(jobId) {
  return `locks/${jobId}.lock`;
}

async function bodyToBuffer(body) {
  if (!body) throw new Error("R2 nesnesi boş döndü.");
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getObjectBuffer(key) {
  const response = await getR2Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  return bodyToBuffer(response.Body);
}

async function putJson(key, value, conditions = {}) {
  return getR2Client().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json; charset=utf-8",
    CacheControl: "no-store",
    ...conditions,
  }));
}

function isNotFound(error) {
  return error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error) {
  return error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
}

async function getJob(jobId) {
  try {
    const response = await getR2Client().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: jobObjectKey(jobId),
    }));
    return { job: JSON.parse((await bodyToBuffer(response.Body)).toString("utf8")), etag: response.ETag };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function createJob(job) {
  return putJson(jobObjectKey(job.id), job, { IfNoneMatch: "*" });
}

async function saveJob(job) {
  const updated = { ...job, updated_at: new Date().toISOString() };
  await putJson(jobObjectKey(job.id), updated);
  return updated;
}

async function createUploadUrl(key, contentType) {
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }),
    { expiresIn: 15 * 60 },
  );
}

async function headObject(key) {
  return getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
}

async function acquireJobLock(jobId) {
  try {
    await getR2Client().send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: lockObjectKey(jobId),
      Body: new Date().toISOString(),
      ContentType: "text/plain",
      IfNoneMatch: "*",
    }));
    return true;
  } catch (error) {
    if (isPreconditionFailed(error)) return false;
    throw error;
  }
}

async function deleteKeys(keys) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 1000) {
    const group = unique.slice(index, index + 1000);
    await getR2Client().send(new DeleteObjectsCommand({
      Bucket: getBucket(),
      Delete: { Objects: group.map((Key) => ({ Key })), Quiet: true },
    }));
  }
}

async function releaseJobLock(jobId) {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: lockObjectKey(jobId) }));
}

async function listObjects(prefix) {
  const objects = [];
  let continuationToken;
  do {
    const response = await getR2Client().send(new ListObjectsV2Command({
      Bucket: getBucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(response.Contents || []));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

module.exports = {
  requireEnv,
  getBucket,
  getR2Client,
  hashClientToken,
  verifyClientToken,
  jobObjectKey,
  lockObjectKey,
  bodyToBuffer,
  getObjectBuffer,
  getJob,
  createJob,
  saveJob,
  createUploadUrl,
  headObject,
  acquireJobLock,
  releaseJobLock,
  deleteKeys,
  listObjects,
};
