exports.handler = async function (event, context) {
  // Sadece POST isteklerini kabul et
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Yalnızca POST isteklerine izin verilir" };
  }

  try {
    const { text } = JSON.parse(event.body);
    
    if (!text || text.length < 50) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ error: "Lütfen analiz için geçerli bir metin gönderin." }) 
        };
    }

    // Netlify ortam değişkenlerinden gizli API anahtarını alıyoruz
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Sunucu hatası: API anahtarı yapılandırılmamış." })
      };
    }

    // YDT Analiz Promptu (Güvenlik için backend'de saklanıyor)
    const systemPrompt = `Sen uzman bir YDT (Yabancı Dil Testi) ve İngilizce eğitim analistisin.
    Görev: Sana verilen metni incelemek ve zorluk derecesini analiz etmektir.
    KURALLAR:
    1. Önce metnin gerçekten bir İngilizce testi, makale veya YDT denemesi olup olmadığını kontrol et. Eğer Türkçe bir şiir, ilgisiz bir makale veya çok kısa saçma bir metinse "isValid" değerini false yap ve "errorMessage" kısmına neden reddettiğini kibarca açıkla (Örn: "Bu metin YDT soru formatına uymuyor.").
    2. Eğer metin İngilizce bir test/deneme ise "isValid" değerini true yap.
    3. Metni analiz et ve şu 4 kategori için 1.0 ile 10.0 arasında (örn: 7.5) zorluk puanı ver:
       - vocab: Kelime dağarcığı zorluğu (CEFR B2/C1 yoğunluğu)
       - grammar: Dilbilgisi ve cümle yapıları karmaşıklığı
       - reading: Okuma parçalarının zorluğu
       - skills: Çeviri, diyalog, anlamca en yakın cümle gibi kısımların zorluğu.
    4. Bu 4 puanı göz önünde bulundurarak "overallScore" hesapla.
    5. "marketEq" alanına Türkiye'deki hangi yayınlara denk geldiğini yaz.
    6. "hardestSection" alanına en zor kategori adını (Türkçe) yaz.
    7. "aiComment" alanına motive edici yorum yaz.`;

    const generationConfig = {
      responseMimeType: "application/json",
      responseSchema: {
          type: "OBJECT",
          properties: {
              "isValid": { type: "BOOLEAN" },
              "errorMessage": { type: "STRING" },
              "overallScore": { type: "NUMBER" },
              "marketEq": { type: "STRING" },
              "hardestSection": { type: "STRING" },
              "scores": {
                  type: "OBJECT",
                  properties: {
                      "vocab": { type: "NUMBER" },
                      "grammar": { type: "NUMBER" },
                      "reading": { type: "NUMBER" },
                      "skills": { type: "NUMBER" }
                  }
              },
              "aiComment": { type: "STRING" }
          },
          required: ["isValid", "overallScore", "marketEq", "hardestSection", "scores", "aiComment"]
      }
    };

    // Google Gemini API'ye İstek Atma
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [{ parts: [{ text: `Analiz Edilecek Metin:\n\n${text}` }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: generationConfig
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("Gemini API'den olumsuz yanıt döndü.");
    }

    const result = await response.json();
    
    if (result.candidates && result.candidates[0].content.parts[0].text) {
        // AI'dan gelen JSON metnini direkt Frontend'e yansıt
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: result.candidates[0].content.parts[0].text
        };
    } else {
        throw new Error("Geçersiz API Yanıtı");
    }

  } catch (error) {
    console.error("Fonksiyon Hatası:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Sunucu işleme sırasında bir hata oluştu." })
    };
  }
};
