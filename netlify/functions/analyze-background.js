"use strict";

const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const { getAdminClient, getBucket } = require("./_shared/supabase");
const { validateJobCredentials } = require("./_shared/validation");
const { parseAnswerKeyFile } = require("./_shared/answer-key");
const { uploadPdf, deleteGeminiFile, generateAnalysis } = require("./_shared/gemini");
const { auditQuestionCoverage, normalizeAnalysis } = require("./_shared/scoring");

async function blobToBuffer(blob) {
  return Buffer.from(await blob.arrayBuffer());
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  let job;
  let geminiFile;
  let shouldCleanup = false;
  const supabase = getAdminClient();
  const bucket = getBucket();
  try {
    const body = parseJsonBody(event);
    const { jobId, clientToken } = validateJobCredentials(body.jobId, body.clientToken);
    const { data: claimed, error: claimError } = await supabase.from("analysis_jobs")
      .update({ status: "processing", progress: 8, error_message: null })
      .eq("id", jobId)
      .eq("client_token", clientToken)
      .eq("status", "awaiting_upload")
      .select("*")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      const { data: existing, error: lookupError } = await supabase.from("analysis_jobs")
        .select("status")
        .eq("id", jobId)
        .eq("client_token", clientToken)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return json(404, { error: "Analiz kaydı bulunamadı." });
      return json(202, { accepted: true, status: existing.status });
    }
    job = claimed;
    shouldCleanup = true;
    const { data: pdfBlob, error: pdfError } = await supabase.storage.from(bucket).download(job.file_path);
    if (pdfError || !pdfBlob) throw new Error("Yüklenen PDF bulunamadı.");
    const pdfBuffer = await blobToBuffer(pdfBlob);
    if (pdfBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("Yüklenen dosya geçerli bir PDF değil.");
    }

    let answerKey = null;
    if (job.key_path) {
      const { data: keyBlob, error: keyError } = await supabase.storage.from(bucket).download(job.key_path);
      if (keyError || !keyBlob) throw new Error("Cevap anahtarı dosyası bulunamadı.");
      answerKey = await parseAnswerKeyFile(await blobToBuffer(keyBlob), job.key_path);
    }

    await supabase.from("analysis_jobs").update({ progress: 24 }).eq("id", job.id);
    geminiFile = await uploadPdf(pdfBuffer, job.original_filename);
    await supabase.from("analysis_jobs").update({ progress: 42 }).eq("id", job.id);

    let raw = await generateAnalysis(geminiFile, answerKey, false);
    const firstAudit = auditQuestionCoverage(raw, answerKey);
    if (!firstAudit.verified) {
      await supabase.from("analysis_jobs").update({ progress: 68 }).eq("id", job.id);
      const retry = await generateAnalysis(geminiFile, answerKey, true);
      const retryAudit = auditQuestionCoverage(retry, answerKey);
      const firstQuality = (firstAudit.verified ? 10000 : 0)
        + firstAudit.detectedQuestions * 100
        + firstAudit.detectedAnswers
        - firstAudit.mismatchedAnswers;
      const retryQuality = (retryAudit.verified ? 10000 : 0)
        + retryAudit.detectedQuestions * 100
        + retryAudit.detectedAnswers
        - retryAudit.mismatchedAnswers;
      if (retryQuality > firstQuality) {
        raw = retry;
      }
    }

    await supabase.from("analysis_jobs").update({ progress: 88 }).eq("id", job.id);
    const result = normalizeAnalysis(raw, answerKey);
    if (!result.isValid) {
      throw new Error(raw.errorMessage || "Belge geçerli bir YDT denemesi olarak doğrulanamadı.");
    }
    if (answerKey?.warnings?.length) result.warnings.push(...answerKey.warnings);
    if (answerKey) result.answerKey = {
      detected: answerKey.count,
      complete: answerKey.complete && result.coverage.comparedAnswers === 80 && result.coverage.mismatchedAnswers === 0,
      source: "uploaded",
      compared: result.coverage.comparedAnswers,
      matched: result.coverage.matchingAnswers,
    };
    else result.answerKey = { detected: result.coverage.detectedAnswers, complete: result.coverage.detectedAnswers === 80, source: "pdf" };
    const hasWarnings = !result.coverage.complete || !result.answerKey.complete || result.warnings.length > 0;

    await supabase.from("analysis_jobs").update({
      status: hasWarnings ? "completed_with_warnings" : "completed",
      progress: 100,
      result,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return json(200, { completed: true });
  } catch (error) {
    console.error("Arka plan analiz hatası:", error);
    if (job?.id) {
      await supabase.from("analysis_jobs").update({
        status: "failed",
        error_message: "Belge analiz edilemedi. Lütfen dosyayı ve servis ayarlarını kontrol edin.",
      }).eq("id", job.id);
    }
    return json(500, { error: "Analiz tamamlanamadı." });
  } finally {
    await deleteGeminiFile(geminiFile);
    if (shouldCleanup && job?.file_path) {
      const paths = [job.file_path, job.key_path].filter(Boolean);
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) console.warn("Geçici Supabase dosyaları silinemedi:", error.message);
    }
  }
};
