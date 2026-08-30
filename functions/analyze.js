exports.handler = async function (event, context) {
  // Sadece POST isteklerine izin veriyoruz
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Yalnızca POST isteklerine izin verilir" };
  }

  try {
    const bodyData = JSON.parse(event.body);
    const { text, images } = bodyData;
    
    // Hem metin hem de resim verisi yoksa hata ver
    if ((!text || text.length < 5) && (!images || images.length === 0)) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ error: "Lütfen analiz için geçerli bir metin veya PDF/Resim dosyası gönderin." }) 
        };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Sunucu hatası: API anahtarı yapılandırılmamış." })
      };
    }

    const systemPrompt = `Sen uzman bir YDT (Yabancı Dil Testi) ve İngilizce eğitim analistisin.
    Görev: Sana verilen metni veya belge sayfalarını incelemek ve zorluk derecesini analiz etmektir. 
    KURALLAR:
    1. Önce içeriğin gerçekten bir İngilizce testi, makale veya YDT denemesi olup olmadığını kontrol et. Eğer Türkçe bir şiir, ilgisiz bir belge, çok kısa anlamsız bir metin veya İngilizce dışı bir dilse "isValid" değerini false yap ve "errorMessage" kısmına neden reddettiğini kibarca açıkla.
    2. Eğer metin/belge İngilizce bir test veya deneme ise "isValid" değerini true yap.
    3. Metni analiz et ve şu 4 kategori için 1.0 ile 10.0 arasında (örn: 7.5, 8.2) zorluk puanı ver:
       - vocab: Kelime dağarcığı zorluğu (CEFR B2/C1 yoğunluğu, phrasal verbs)
       - grammar: Dilbilgisi, tense ve cümle yapıları karmaşıklığı
       - reading: Okuma parçalarının zorluğu ve paragraf uzunlukları
       - skills: Çeviri, diyalog, anlamca en yakın cümle gibi kısımların zorluğu.
    4. Bu 4 puanı göz önünde bulundurarak "overallScore" hesapla.
    5. "marketEq" alanına Türkiye'deki hangi yayınlara (ÖSYM, Özdebir, YDS Publishing, Akın Dil vb.) denk geldiğini veya zorluk kıyaslamasını yaz.
    6. "hardestSection" alanına en zor kategori adını (Türkçe) yaz.
    7. "aiComment" alanına öğrenci için motive edici ve yapıcı bir değerlendirme yorumu yaz.`;

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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    let payloadParts = [];
    
    // Eğer frontend'den sıkıştırılmış resimler (sayfalar) geldiyse bunları ekle
    if (images && images.length > 0) {
        images.forEach(base64Str => {
            // "data:image/jpeg;base64," kısmını atarak sadece raw data'yı alıyoruz
            const rawData = base64Str.includes(',') ? base64Str.split(',')[1] : base64Str;
            payloadParts.push({
                inlineData: {
                    data: rawData,
                    mimeType: "image/jpeg"
                }
            });
        });
        payloadParts.push({ text: "Analiz edilecek deneme sayfaları yukarıdadır. Lütfen sayfaları dikkatlice oku ve talimatlara göre analiz et." });
    } 
    // Sadece düz metin geldiyse
    else if (text) {
        payloadParts.push({ text: `Analiz Edilecek Metin:\n\n${text}` });
    }

    const payload = {
      contents: [{ parts: payloadParts }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: generationConfig
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API Error:", errorText);
        throw new Error("Gemini API'den olumsuz yanıt döndü.");
    }

    const result = await response.json();
    
    if (result.candidates && result.candidates[0].content.parts[0].text) {
        return {
            statusCode: 200,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" 
            },
            body: result.candidates[0].content.parts[0].text
        };
    } else {
        throw new Error("Geçersiz API Yanıtı");
    }

  } catch (error) {
    console.error("Fonksiyon Hatası:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Sunucu işleme sırasında bir hata oluştu veya boyut sınırı aşıldı." })
    };
  }
};
