"use strict";

const { requireEnv } = require("./supabase");
const { formatAnswerKey } = require("./answer-key");

const API_ROOT = "https://generativelanguage.googleapis.com";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function uploadPdf(buffer, displayName) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const startResponse = await fetch(`${API_ROOT}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": "application/pdf",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startResponse.ok) throw new Error(`Gemini dosya oturumu açılamadı (${startResponse.status}).`);
  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini yükleme adresi alınamadı.");

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
  });
  if (!uploadResponse.ok) throw new Error(`PDF Gemini'ye yüklenemedi (${uploadResponse.status}).`);
  const payload = await uploadResponse.json();
  return waitUntilActive(payload.file);
}

async function waitUntilActive(file) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  let current = file;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = String(current?.state || "ACTIVE").toUpperCase();
    if (state === "ACTIVE") return current;
    if (state === "FAILED") throw new Error("Gemini PDF dosyasını işleyemedi.");
    await delay(3000);
    const response = await fetch(`${API_ROOT}/v1beta/${current.name}?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) throw new Error("Gemini dosya durumu okunamadı.");
    current = await response.json();
  }
  throw new Error("Gemini PDF hazırlama işlemi zaman aşımına uğradı.");
}

async function deleteGeminiFile(file) {
  if (!file?.name) return;
  try {
    const apiKey = requireEnv("GEMINI_API_KEY");
    await fetch(`${API_ROOT}/v1beta/${file.name}?key=${encodeURIComponent(apiKey)}`, { method: "DELETE" });
  } catch (error) {
    console.warn("Gemini geçici dosyası silinemedi:", error.message);
  }
}

function responseSchema() {
  const score = { type: "NUMBER" };
  return {
    type: "OBJECT",
    properties: {
      isValid: { type: "BOOLEAN" },
      errorMessage: { type: "STRING" },
      confidence: score,
      closestReferenceComment: { type: "STRING" },
      scores: {
        type: "OBJECT",
        properties: {
          vocabulary: score,
          grammar: score,
          reading: score,
          questionSkills: score,
          distractors: score,
          timePressure: score,
        },
        required: ["vocabulary", "grammar", "reading", "questionSkills", "distractors", "timePressure"],
      },
      coverage: {
        type: "OBJECT",
        properties: { detectedQuestions: score, detectedAnswers: score },
        required: ["detectedQuestions", "detectedAnswers"],
      },
      questionAudit: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            number: score,
            answer: { type: "STRING" },
            type: { type: "STRING" },
            difficulty: score,
            confidence: score,
          },
          required: ["number", "answer", "type", "difficulty", "confidence"],
        },
      },
      cefrProfile: {
        type: "OBJECT",
        properties: { b1: score, b2: score, c1: score, c2: score },
        required: ["b1", "b2", "c1", "c2"],
      },
      sectionAnalysis: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            questionRange: { type: "STRING" },
            score: score,
            rationale: { type: "STRING" },
          },
          required: ["name", "questionRange", "score", "rationale"],
        },
      },
      hardestQuestionTypes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { type: { type: "STRING" }, score: score, reason: { type: "STRING" } },
          required: ["type", "score", "reason"],
        },
      },
      strengths: { type: "ARRAY", items: { type: "STRING" } },
      warnings: { type: "ARRAY", items: { type: "STRING" } },
      educationalComment: { type: "STRING" },
    },
    required: [
      "isValid", "errorMessage", "confidence", "scores", "coverage", "questionAudit", "cefrProfile",
      "sectionAnalysis", "hardestQuestionTypes", "strengths", "warnings", "educationalComment",
    ],
  };
}

function buildPrompt(answerKey, strictRetry) {
  const retryText = strictRetry
    ? "ÖNCEKİ TARAMA EKSİKTİ. Tüm sayfaları tekrar incele ve 1-80 arasındaki her soru numarasını tek tek doğrula."
    : "Belgenin bütün sayfalarını incele.";
  return `Sen uzman bir YDT ölçme-değerlendirme analistisin. ${retryText}

Amaç: Bu denemenin ÖSYM YDT'ye göre TAHMİNİ zorluk düzeyini ölçmek.
Telif güvenliği: Soru köklerini, paragrafları veya seçenekleri cevabında yeniden yazma. Yalnızca türetilmiş ölçümler ve kısa gerekçeler üret.

Kalibrasyon çıpaları:
- 2022 ÖSYM: 55/100 (Orta)
- 2023 ÖSYM: 57/100 (Orta)
- 2024 ÖSYM: 61/100 (Orta-zor)
- 2025 ÖSYM: 69/100 (Zor)
- 2026 ÖSYM: 58/100 (Orta)

Her boyutu 0-100 puanla:
- vocabulary: CEFR dağılımı, düşük sıklıklı sözcükler, collocation ve phrasal verb
- grammar: cümle uzunluğu, yan cümlecikler, zaman ve yapı karmaşıklığı
- reading: metin yoğunluğu, soyutluk, çıkarım ve bağdaşıklık
- questionSkills: çeviri, diyalog, yakın anlam, durum, paragraf tamamlama gibi bilişsel yük
- distractors: yanlış seçeneklerin doğru cevaba yakınlığı ve ikna ediciliği
- timePressure: toplam okuma ve işlem yükü

Belgede veya verilen harici anahtarda bulunan doğru cevaplarla seçenekleri eşleştir. Tam olarak 80 soru aramalısın. questionAudit alanına 1-80 için ayrı kayıt koy; number soru numarası, answer A-E doğru cevap, type kısa soru türü, difficulty ve confidence 0-100 olsun. Soru metni veya seçenek metni ekleme. Eksik, yinelenen veya okunamayan soruları warnings alanında bildir. CEFR yüzdeleri toplamı yaklaşık 100 olmalıdır.

Harici cevap anahtarı:
${formatAnswerKey(answerKey)}

Türkçe, kısa ve kanıta dayalı gerekçeler üret. Genel zorluk puanını sen hesaplama; sunucu sabit ağırlıklarla hesaplayacak.`;
}

async function generateAnalysis(file, answerKey, strictRetry = false) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const response = await fetch(`${API_ROOT}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { fileData: { mimeType: "application/pdf", fileUri: file.uri } },
          { text: buildPrompt(answerKey, strictRetry) },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema(),
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Gemini analiz hatası:", response.status, detail.slice(0, 1200));
    throw new Error(`Gemini analiz isteği başarısız (${response.status}).`);
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini boş bir analiz yanıtı döndürdü.");
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini analiz yanıtı geçerli JSON değildi.");
  }
}

module.exports = { uploadPdf, deleteGeminiFile, generateAnalysis };
