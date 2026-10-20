export type FoodInterpretation = {
  food_name: string;
  quantity: number | null;
  unit: string | null;
  brand: string | null;
  confidence: number;
  food_type: string | null;
  search_terms: string[];
  translated_search_terms: string[];
  notes: string | null;
  meal_type: string | null;
};

const REQUEST_TIMEOUT_MS = 8_000;

async function requestWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Food interpretation timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeConfidence(value: unknown): number {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
}

export const foodAiService = {
  async interpret(text: string): Promise<FoodInterpretation> {
    const message = text.trim();
    if (!message) throw new Error("Food text is required");

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const schema = {
      type: "OBJECT",
      properties: {
        food_name: { type: "STRING" },
        quantity: { type: "NUMBER", nullable: true },
        unit: { type: "STRING", nullable: true },
        brand: { type: "STRING", nullable: true },
        confidence: { type: "NUMBER" },
        food_type: { type: "STRING", nullable: true },
        search_terms: { type: "ARRAY", items: { type: "STRING" } },
        translated_search_terms: { type: "ARRAY", items: { type: "STRING" } },
        notes: { type: "STRING", nullable: true },
        meal_type: { type: "STRING", nullable: true },
      },
      required: ["food_name", "quantity", "unit", "brand", "confidence", "food_type", "search_terms", "translated_search_terms", "notes", "meal_type"],
    };

    const response = await requestWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: [
                "Você é um serviço de interpretação de alimentos para o Brasil.",
                "Corrija erros de digitação, normalize o nome no singular e diferencie alimentos semelhantes.",
                "Extraia quantidade, unidade, marca e tipo; converta medidas para unidades métricas quando for seguro.",
                "Gere até 6 termos de busca úteis para o Open Food Facts em português brasileiro.",
                "Gere também até 6 termos equivalentes em inglês no campo translated_search_terms, pois alguns produtos estão cadastrados apenas em inglês.",
                "Para '2 ovos mexidos', retorne food_name 'ovo mexido', quantity 2 e unit 'unidade'.",
                "Para '200 ml de leite integral', retorne food_name 'leite integral', quantity 200 e unit 'ml'.",
                "Não invente nutrientes. Use confidence entre 0 e 1 conforme a certeza da interpretação.",
                "Se o texto indicar uma refeição, retorne meal_type usando apenas café da manhã, lanche, almoço, lanche da tarde, jantar, ceia ou outras; caso contrário, null.",
                "Responda somente no JSON especificado.",
              ].join(" "),
            }],
          },
          contents: [{
            role: "user",
            parts: [{ text: `Interprete este texto em português brasileiro: "${message}".` }],
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
      },
    );

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const providerError = payload.error as { message?: string; status?: string } | undefined;
      throw new Error(
        `Gemini ${response.status}${providerError?.status ? ` (${providerError.status})` : ""}: ${
          providerError?.message?.trim() || "request rejected"
        }`,
      );
    }
    const candidates = payload.candidates;
    const firstCandidate = Array.isArray(candidates) ? candidates[0] as Record<string, unknown> : null;
    const content = firstCandidate?.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    const part = Array.isArray(parts) ? parts[0] as Record<string, unknown> : null;
    if (typeof part?.text !== "string") throw new Error("Food interpretation returned no structured data");

    const parsed = JSON.parse(part.text) as Partial<FoodInterpretation>;
    const foodName = String(parsed.food_name ?? "").trim();
    if (!foodName) throw new Error("Food interpretation returned no food name");
    return {
      food_name: foodName,
      quantity: parsed.quantity == null ? null : Number(parsed.quantity),
      unit: parsed.unit ? String(parsed.unit) : null,
      brand: parsed.brand ? String(parsed.brand) : null,
      confidence: normalizeConfidence(parsed.confidence),
      food_type: parsed.food_type ? String(parsed.food_type) : null,
      search_terms: Array.isArray(parsed.search_terms)
        ? parsed.search_terms.map((term) => String(term).trim()).filter(Boolean).slice(0, 6)
        : [foodName],
      translated_search_terms: Array.isArray(parsed.translated_search_terms)
        ? parsed.translated_search_terms.map((term) => String(term).trim()).filter(Boolean).slice(0, 6)
        : [],
      notes: parsed.notes ? String(parsed.notes) : null,
      meal_type: parsed.meal_type ? String(parsed.meal_type) : null,
    };
  },
};
