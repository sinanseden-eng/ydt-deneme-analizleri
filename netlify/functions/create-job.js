"use strict";

const crypto = require("node:crypto");
const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const { getAdminClient, getPublicConfig, getBucket } = require("./_shared/supabase");
const {
  cleanText, safeFileName, validatePdf, validateAnswerKey, validateAccessCode,
} = require("./_shared/validation");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const body = parseJsonBody(event);
    validateAccessCode(body.accessCode);
    const pdf = validatePdf(body.pdf);
    const answerKey = validateAnswerKey(body.answerKey);
    const examName = cleanText(body.examName, 140) || pdf.fileName.replace(/\.pdf$/i, "");
    const jobId = crypto.randomUUID();
    const clientToken = crypto.randomUUID();
    const pdfPath = `${jobId}/${safeFileName(pdf.fileName, "exam.pdf")}`;
    const keyPath = answerKey
      ? `${jobId}/${safeFileName(answerKey.fileName, "answer-key.xlsx")}`
      : null;
    const supabase = getAdminClient();
    const bucket = getBucket();

    const { error: insertError } = await supabase.from("analysis_jobs").insert({
      id: jobId,
      client_token: clientToken,
      status: "awaiting_upload",
      progress: 0,
      exam_name: examName,
      original_filename: pdf.fileName,
      file_path: pdfPath,
      key_path: keyPath,
    });
    if (insertError) throw new Error(`Analiz kaydı oluşturulamadı: ${insertError.message}`);

    try {
      const { data: pdfUpload, error: pdfError } = await supabase.storage.from(bucket)
        .createSignedUploadUrl(pdfPath, { upsert: false });
      if (pdfError) throw pdfError;
      let keyUpload = null;
      if (keyPath) {
        const { data, error } = await supabase.storage.from(bucket)
          .createSignedUploadUrl(keyPath, { upsert: false });
        if (error) throw error;
        keyUpload = { path: keyPath, token: data.token };
      }
      return json(201, {
        jobId,
        clientToken,
        publicConfig: getPublicConfig(),
        uploads: {
          pdf: { path: pdfPath, token: pdfUpload.token },
          answerKey: keyUpload,
        },
      });
    } catch (error) {
      await supabase.from("analysis_jobs").delete().eq("id", jobId);
      throw error;
    }
  } catch (error) {
    console.error("İş oluşturma hatası:", error.message);
    return json(error.statusCode || 500, {
      error: error.safe ? error.message : "Analiz işi başlatılamadı. Sunucu ayarlarını kontrol edin.",
    });
  }
};
