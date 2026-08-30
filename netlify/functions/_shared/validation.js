"use strict";

const crypto = require("node:crypto");

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_KEY_BYTES = 2 * 1024 * 1024;
const KEY_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function safeFileName(value, fallback) {
  const name = cleanText(value, 180)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return name || fallback;
}

function validatePdf(meta = {}) {
  const fileName = cleanText(meta.fileName, 180);
  const size = Number(meta.fileSize);
  const mimeType = cleanText(meta.mimeType, 100).toLowerCase();
  if (!fileName || !Number.isFinite(size)) throw userError("PDF dosyası bilgileri eksik.");
  if (size <= 0 || size > MAX_PDF_BYTES) throw userError("PDF en fazla 50 MB olabilir.");
  if (mimeType !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) {
    throw userError("Yalnızca PDF dosyaları kabul edilir.");
  }
  return { fileName, size, mimeType: "application/pdf" };
}

function validateAnswerKey(meta) {
  if (!meta) return null;
  const fileName = cleanText(meta.fileName, 180);
  const size = Number(meta.fileSize);
  const mimeType = cleanText(meta.mimeType, 100).toLowerCase() || "application/octet-stream";
  const extensionOk = /\.(xlsx|csv)$/i.test(fileName);
  if (!fileName || !Number.isFinite(size) || size <= 0 || size > MAX_KEY_BYTES) {
    throw userError("Cevap anahtarı en fazla 2 MB olabilir.");
  }
  if (!extensionOk || !KEY_MIME_TYPES.has(mimeType)) {
    throw userError("Cevap anahtarı XLSX veya CSV biçiminde olmalıdır.");
  }
  return { fileName, size, mimeType };
}

function validateAccessCode(received) {
  const expected = process.env.APP_ACCESS_CODE;
  if (!expected) throw serverError("APP_ACCESS_CODE yapılandırılmamış.");
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw userError("Erişim kodu hatalı.", 401);
  }
}

function validateJobCredentials(jobId, clientToken) {
  const id = cleanText(jobId, 80);
  const token = cleanText(clientToken, 120);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(token)) {
    throw userError("Analiz kimliği geçersiz.", 400);
  }
  return { jobId: id, clientToken: token };
}

function userError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.safe = true;
  return error;
}

function serverError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

module.exports = {
  MAX_PDF_BYTES,
  MAX_KEY_BYTES,
  cleanText,
  safeFileName,
  validatePdf,
  validateAnswerKey,
  validateAccessCode,
  validateJobCredentials,
  userError,
};
