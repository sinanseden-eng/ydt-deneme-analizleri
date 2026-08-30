"use strict";

const crypto = require("node:crypto");
const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const {
  createJob, createUploadUrl, deleteKeys, hashClientToken, jobObjectKey,
} = require("./_shared/r2");
const {
  cleanText, safeFileName, validatePdf, validateAnswerKey, validateAccessCode,
} = require("./_shared/validation");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  let jobId;
  try {
    const body = parseJsonBody(event);
    validateAccessCode(body.accessCode);
    const pdf = validatePdf(body.pdf);
    const answerKey = validateAnswerKey(body.answerKey);
    const examName = cleanText(body.examName, 140) || pdf.fileName.replace(/\.pdf$/i, "");
    jobId = crypto.randomUUID();
    const clientToken = crypto.randomUUID();
    const pdfPath = `uploads/${jobId}/${safeFileName(pdf.fileName, "exam.pdf")}`;
    const keyPath = answerKey
      ? `uploads/${jobId}/${safeFileName(answerKey.fileName, "answer-key.xlsx")}`
      : null;
    const now = new Date().toISOString();

    await createJob({
      id: jobId,
      client_token_hash: hashClientToken(clientToken),
      status: "awaiting_upload",
      progress: 0,
      exam_name: examName,
      original_filename: pdf.fileName,
      file_path: pdfPath,
      file_size: pdf.size,
      file_type: pdf.mimeType,
      key_path: keyPath,
      key_size: answerKey?.size || null,
      key_type: answerKey?.mimeType || null,
      result: null,
      error_message: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    });

    const pdfUrl = await createUploadUrl(pdfPath, pdf.mimeType);
    const keyUrl = keyPath ? await createUploadUrl(keyPath, answerKey.mimeType) : null;
    return json(201, {
      jobId,
      clientToken,
      uploads: {
        pdf: { url: pdfUrl, contentType: pdf.mimeType },
        answerKey: keyUrl ? { url: keyUrl, contentType: answerKey.mimeType } : null,
      },
    });
  } catch (error) {
    console.error("İş oluşturma hatası:", error.message);
    if (jobId) {
      try { await deleteKeys([jobObjectKey(jobId)]); } catch (cleanupError) {
        console.warn("Eksik iş kaydı temizlenemedi:", cleanupError.message);
      }
    }
    return json(error.statusCode || 500, {
      error: error.safe ? error.message : "Analiz işi başlatılamadı. R2 ve sunucu ayarlarını kontrol edin.",
    });
  }
};
