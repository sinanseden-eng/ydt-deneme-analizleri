"use strict";

const { json, parseJsonBody, methodNotAllowed } = require("./_shared/http");
const { getAdminClient } = require("./_shared/supabase");
const { validateJobCredentials } = require("./_shared/validation");

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return methodNotAllowed();
  try {
    const body = parseJsonBody(event);
    const { jobId, clientToken } = validateJobCredentials(body.jobId, body.clientToken);
    const { data, error } = await getAdminClient().from("analysis_jobs")
      .select("id,status,progress,exam_name,result,error_message,created_at,completed_at")
      .eq("id", jobId)
      .eq("client_token", clientToken)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json(404, { error: "Analiz kaydı bulunamadı." });
    return json(200, data);
  } catch (error) {
    console.error("Durum sorgulama hatası:", error.message);
    return json(error.statusCode || 500, { error: error.safe ? error.message : "Analiz durumu okunamadı." });
  }
};
