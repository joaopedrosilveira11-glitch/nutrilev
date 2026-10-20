import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openFoodFactsService } from "../openFoodFactsService.ts";
import { foodAiService, type FoodInterpretation } from "../foodAiService.ts";

type Action =
  | "next_meal"
  | "meal_options"
  | "generate_recipe"
  | "healthier_alternative"
  | "adapt_recipe"
  | "high_protein"
  | "lower_calorie"
  | "quick_meal"
  | "budget_meal"
  | "explain_fit"
  | "replace_ingredient"
  | "adjust_serving"
  | "estimate_nutrition"
  | "add_to_plan"
  | "food_search"
  | "food_barcode"
  | "chat";

type AiRequest = {
  action: Action;
  message?: string;
  ingredients?: string[];
  meal_type?: string;
  preparation_time?: number;
  servings?: number;
  recipe?: string;
  conversation_id?: string;
  generated_meal_id?: string;
  food_text?: string;
  barcode?: string;
  profile?: Record<string, unknown>;
};

type AssistantResponse = {
  kind: "meal" | "options" | "guidance" | "safety";
  meal_name: string | null;
  description: string;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  preparation_time: number | null;
  ingredients: string[];
  instructions: string[];
  tags: string[];
  suitability_reason: string;
  safety_message: string;
  alternatives: string[];
};

type Provider = {
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<AssistantResponse>;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const safetyMessage =
  "Nutri IA oferece orientação geral de nutrição e não substitui um médico ou nutricionista registrado.";
const APP_LOCALE = "pt-BR";

const dangerousPatterns = [
  /\b(i want to|quero)\s+(starve|me matar de fome)/i,
  /\b(fasting|jejum)\s+(for|por)\s+\d+\s*(days|dias)/i,
  /\b(binge|compuls|vomit|vomitar|purge|laxative|laxante)/i,
  /\b(anorexia|bulimia|eating disorder|transtorno alimentar)/i,
  /\b(diabetes|diabete|kidney disease|doença renal|pregnan|grávid)/i,
  /\b(insulin|insulina|medication|medicação|remédio|diagnos)/i,
];

const responseSchema = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["meal", "options", "guidance", "safety"] },
    meal_name: { type: "STRING", nullable: true },
    description: { type: "STRING" },
    calories: { type: "NUMBER", nullable: true },
    protein: { type: "NUMBER", nullable: true },
    carbohydrates: { type: "NUMBER", nullable: true },
    fat: { type: "NUMBER", nullable: true },
    preparation_time: { type: "INTEGER", nullable: true },
    ingredients: { type: "ARRAY", items: { type: "STRING" } },
    instructions: { type: "ARRAY", items: { type: "STRING" } },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    suitability_reason: { type: "STRING" },
    safety_message: { type: "STRING" },
    alternatives: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "kind",
    "meal_name",
    "description",
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "preparation_time",
    "ingredients",
    "instructions",
    "tags",
    "suitability_reason",
    "safety_message",
    "alternatives",
  ],
};

function getCacheClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function normalizeFoodSearch(message: string): string {
  return message.trim().toLocaleLowerCase("pt-BR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

async function cachedFoodSearch(message: string): Promise<Record<string, unknown>[] | null> {
  const cache = getCacheClient();
  const queryKey = normalizeFoodSearch(message);
  const result = await cache.from("food_search_cache").select("items, use_count")
    .eq("query_key", queryKey).maybeSingle();
  if (result.error) {
    if (result.error.code === "42P01" || result.error.code === "PGRST205") return null;
    throw result.error;
  }
  if (!result.data) return null;
  await cache.from("food_search_cache").update({
    last_used_at: new Date().toISOString(),
    use_count: Number((result.data as { use_count?: number }).use_count || 0) + 1,
  }).eq("query_key", queryKey);
  return Array.isArray(result.data.items) ? result.data.items as Record<string, unknown>[] : null;
}

async function saveFoodSearch(message: string, items: Record<string, unknown>[]): Promise<void> {
  const cache = getCacheClient();
  const queryKey = normalizeFoodSearch(message);
  const result = await cache.from("food_search_cache").upsert({
    query_key: queryKey,
    query_text: message.trim(),
    items,
    last_used_at: new Date().toISOString(),
  }, { onConflict: "query_key" });
  if (result.error && result.error.code !== "42P01" && result.error.code !== "PGRST205") {
    throw result.error;
  }
  for (const item of items) {
    const sourceId = String(item.food_id || "");
    if (!sourceId) continue;
    const food = await cache.from("foods").upsert({
      name: String(item.name),
      source: "ai_generated",
      source_id: sourceId,
      serving_size: Number(item.quantity) || 100,
      serving_unit: String(item.unit || "g"),
      calories: Number(item.calories),
      protein_grams: Number(item.protein),
      is_verified: true,
      is_public: true,
    }, { onConflict: "source,source_id" });
    if (food.error) console.error("Could not cache food catalog item", food.error);
  }
}

function getSupabase(request: Request): SupabaseClient {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }

  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
}

function isSafetySensitive(input: AiRequest): boolean {
  const text = [
    input.message,
    input.recipe,
    ...(input.ingredients ?? []),
  ].filter(Boolean).join(" ");
  return dangerousPatterns.some((pattern) => pattern.test(text));
}

function safetyResponse(): AssistantResponse {
  return {
    kind: "safety",
    meal_name: null,
    description:
      "Não posso orientar sobre comportamentos alimentares perigosos, diagnósticos ou tratamentos. Procure um médico ou nutricionista registrado para uma avaliação individual. Se houver risco imediato, procure um serviço de emergência.",
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    preparation_time: null,
    ingredients: [],
    instructions: [],
    tags: ["professional-support"],
    suitability_reason: "A segurança vem antes de qualquer meta nutricional.",
    safety_message: safetyMessage,
    alternatives: [],
  };
}

async function fetchOpenFoodFactsSearch(query: string): Promise<Array<Record<string, unknown>>> {
  return openFoodFactsService.searchFoods(query) as Promise<Array<Record<string, unknown>>>;
}

async function fetchOpenFoodFactsFoodById(foodId: string): Promise<Record<string, unknown> | null> {
  return openFoodFactsService.getFood(foodId) as Promise<Record<string, unknown> | null>;
}

async function searchFoodWithGemini(message: string): Promise<Record<string, unknown>[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
  const schema = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            quantity: { type: "NUMBER" },
            unit: { type: "STRING" },
            calories: { type: "NUMBER" },
            protein: { type: "NUMBER" },
            carbs: { type: "NUMBER" },
            fat: { type: "NUMBER" },
            confidence: { type: "NUMBER" },
          },
          required: ["name", "quantity", "unit", "calories", "protein", "carbs", "fat", "confidence"],
        },
      },
    },
    required: ["items"],
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              "Você é uma fonte nutricional para alimentos consumidos no Brasil.",
              "Use somente seu conhecimento nutricional geral e deixe claro que os valores são estimativas.",
              "Interprete uma lista de alimentos em português, separada por vírgulas ou pela palavra e.",
              "Retorne um item para cada alimento, com valores para exatamente a quantidade e unidade informadas.",
              "Se a quantidade não for informada, use 100 g quando o alimento for medido por peso, ou 1 unidade quando isso for mais natural.",
              "Retorne calorias, proteína, carboidratos e gordura em números, sem unidades.",
              "Não use Open Food Facts, catálogo externo, busca externa ou valores de outra API.",
              "Responda somente no JSON especificado.",
            ].join(" "),
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Calcule os nutrientes desta refeição: "${message}"` }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
        }),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error as { message?: string } | undefined;
    throw new Error(providerError?.message?.trim() || `Gemini ${response.status}`);
  }
  const candidates = payload.candidates;
  const firstCandidate = Array.isArray(candidates) ? candidates[0] as Record<string, unknown> : null;
  const content = firstCandidate?.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  const part = Array.isArray(parts) ? parts[0] as Record<string, unknown> : null;
  if (typeof part?.text !== "string") throw new Error("Gemini não retornou dados nutricionais estruturados");
  const parsed = JSON.parse(part.text) as { items?: Array<Record<string, unknown>> };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map((item, index) => {
    const name = String(item.name ?? "").trim();
    const quantity = Number(item.quantity);
    const unit = String(item.unit ?? "g").trim();
    const calories = Number(item.calories);
    const protein = Number(item.protein);
    const carbs = Number(item.carbs);
    const fat = Number(item.fat);
    const confidence = Number(item.confidence);
    if (!name || !Number.isFinite(quantity) || !Number.isFinite(calories) || !Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat)) {
      throw new Error(`Gemini retornou dados incompletos para o alimento ${index + 1}`);
    }
    const foodId = `gemini-${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70)}`;
    return {
      source: "gemini",
      matched: true,
      food_id: foodId,
      name,
      quantity,
      unit,
      calories,
      protein,
      carbs,
      fat,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      message: "Proteínas e carboidratos estimados exclusivamente pelo Gemini.",
    };
  });
}

function fallbackFoodInterpretation(message: string): FoodInterpretation {
  const text = message.trim();
  const quantityMatch = text.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|unidade|unidades|porção|porções)?\s*(?:de\s+)?(.+)$/i);
  const quantity = quantityMatch ? Number(quantityMatch[1].replace(",", ".")) : null;
  const unit = quantityMatch?.[2]?.toLowerCase() || null;
  const foodName = (quantityMatch?.[3] || text).trim();
  return {
    food_name: foodName,
    quantity,
    unit,
    brand: null,
    confidence: 0,
    food_type: null,
    search_terms: [foodName, text].filter((term, index, terms) => terms.indexOf(term) === index),
    translated_search_terms: [],
    notes: "Busca realizada sem interpretação automática.",
    meal_type: null,
  };
}

function searchWords(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !["com", "sem", "para", "uma", "uns"].includes(word));
}

function scaleFoodValue(value: unknown, quantity: number | null, unit: string | null): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalizedUnit = String(unit || "").toLowerCase();
  if (quantity && ["g", "kg", "ml", "l"].includes(normalizedUnit)) {
    const grams = normalizedUnit === "kg" ? quantity * 1000 : normalizedUnit === "l" ? quantity * 1000 : quantity;
    return numeric * grams / 100;
  }
  return numeric;
}

async function resolveFoodFromText(message: string): Promise<Record<string, unknown>> {
  let parsed: FoodInterpretation;
  try {
    parsed = await foodAiService.interpret(message);
  } catch (error) {
    console.warn("Food interpretation unavailable; searching Open Food Facts with original text", error);
    parsed = fallbackFoodInterpretation(message);
  }
  const rawTerms = [
    message,
    ...(parsed.search_terms || []),
    ...(parsed.translated_search_terms || []),
    parsed.food_name,
  ];
  if (!rawTerms.length) rawTerms.push(parsed.food_name);
  const uniqueTerms = [...new Set(rawTerms.map((term) => String(term).trim()).filter(Boolean))  ].slice(0, 3);
  const candidateMap = new Map<string, Record<string, unknown>>();

  for (const term of uniqueTerms) {
    try {
      const results = await fetchOpenFoodFactsSearch(term);
      for (const item of results) {
        const normalized = item;
        const key = String(normalized.id ?? normalized.name ?? "");
        if (!key) continue;
        if (!candidateMap.has(key)) {
          candidateMap.set(key, normalized as Record<string, unknown>);
        }
      }
    } catch (error) {
      console.warn(`Open Food Facts search failed for term "${term}"`, error);
    }

    if (candidateMap.size >= 20) break;
  }

  let candidates = [...candidateMap.values()];

  if (!candidates.length) {
    const fallback = await fetchOpenFoodFactsSearch(parsed.food_name);
    candidates = fallback;
  }
  if (!candidates.length && message.trim() !== parsed.food_name.trim()) {
    candidates = await fetchOpenFoodFactsSearch(message.trim());
  }

  const ranked = candidates
    .map((candidate) => {
      const comparison = String(candidate.name ?? "");
      const parsedName = String(parsed.food_name ?? "");
      const brand = String(parsed.brand ?? "").toLowerCase();
      const itemBrand = String(candidate.brand ?? "").toLowerCase();
      const productWords = searchWords(comparison);
      const requestedVariants = [parsedName, ...(parsed.translated_search_terms || [])]
        .map(searchWords)
        .filter((words) => words.length);
      const bestMatch = requestedVariants.reduce((best, words) => {
        const matched = words.filter((word) => productWords.includes(word));
        const overlap = words.length ? matched.length / words.length : 0;
        return overlap > best.overlap ? { words, matched, overlap } : best;
      }, { words: [] as string[], matched: [] as string[], overlap: 0 });
      const requestedWords = bestMatch.words;
      const matchedWords = bestMatch.matched;
      const allWordsMatch = requestedWords.length > 0 && matchedWords.length === requestedWords.length;
      const overlap = bestMatch.overlap;
      let matchScore = overlap * 100;
      if (allWordsMatch) matchScore += 40;
      if (comparison.toLowerCase().includes(parsedName.toLowerCase())) matchScore += 30;
      if (brand && itemBrand && (itemBrand.includes(brand) || brand.includes(itemBrand))) matchScore += 15;
      return { candidate, score: matchScore, matchedWords: matchedWords.length };
    })
    .sort((left, right) => right.score - left.score);

  const rankedCandidates = (ranked.filter((entry) => entry.matchedWords > 0 || searchWords(parsed.food_name).length === 0).length
    ? ranked.filter((entry) => entry.matchedWords > 0 || searchWords(parsed.food_name).length === 0)
    : ranked)
    .map((entry) => entry.candidate);

  const selectedCandidate = rankedCandidates[0];
  const detailed = selectedCandidate && selectedCandidate.id ? await fetchOpenFoodFactsFoodById(String(selectedCandidate.id)) : null;
  const finalCandidate = detailed ?? selectedCandidate;

  const candidateList = rankedCandidates.length
    ? rankedCandidates.slice(0, 6).map((item) => {
        const candidate = detailed && String(detailed.id ?? "") === String(item.id ?? "") ? detailed : item;
        return {
        id: candidate.id ? String(candidate.id) : `${String(candidate.name).toLowerCase()}-${Math.random().toString(16).slice(2)}`,
        name: String(candidate.name ?? parsed.food_name),
        brand: candidate.brand ? String(candidate.brand) : parsed.brand,
        category: candidate.category ? String(candidate.category) : parsed.food_type,
        quantity: Number(parsed.quantity ?? candidate.quantity ?? 100),
        unit: parsed.unit ?? String(candidate.unit ?? "g"),
        calories: candidate.calories == null ? null : Number(candidate.calories),
        protein: candidate.protein == null ? null : Number(candidate.protein),
        carbs: candidate.carbs == null ? null : Number(candidate.carbs),
        fat: candidate.fat == null ? null : Number(candidate.fat),
        fiber: candidate.fiber == null ? null : Number(candidate.fiber),
        sugar: candidate.sugar == null ? null : Number(candidate.sugar),
        sodium: candidate.sodium == null ? null : Number(candidate.sodium),
        servings: Array.isArray(candidate.servings) ? candidate.servings.map((serving) => ({
          amount: Number(serving.amount ?? 100),
          unit: String(serving.unit ?? candidate.unit ?? "g"),
          calories: serving.calories == null ? null : Number(serving.calories),
          protein: serving.protein == null ? null : Number(serving.protein),
          carbs: serving.carbs == null ? null : Number(serving.carbs),
          fat: serving.fat == null ? null : Number(serving.fat),
          fiber: serving.fiber == null ? null : Number(serving.fiber),
          sugar: serving.sugar == null ? null : Number(serving.sugar),
          sodium: serving.sodium == null ? null : Number(serving.sodium),
          description: String(serving.description ?? `${Number(serving.amount ?? 100)} ${String(serving.unit ?? candidate.unit ?? "g")}`),
        })) : [{
          amount: Number(candidate.quantity ?? 100),
          unit: String(candidate.unit ?? parsed.unit ?? "g"),
          calories: candidate.calories == null ? null : Number(candidate.calories),
          protein: candidate.protein == null ? null : Number(candidate.protein),
          carbs: candidate.carbs == null ? null : Number(candidate.carbs),
          fat: candidate.fat == null ? null : Number(candidate.fat),
          fiber: candidate.fiber == null ? null : Number(candidate.fiber),
          sugar: candidate.sugar == null ? null : Number(candidate.sugar),
          sodium: candidate.sodium == null ? null : Number(candidate.sodium),
          description: `${Number(candidate.quantity ?? 100)} ${String(candidate.unit ?? parsed.unit ?? "g")}`,
        }],
      };
      })
    : [];

  if (!candidateList.length) {
    return {
      source: "openfoodfacts",
      language: APP_LOCALE,
      parsed: parsed,
      matched: false,
      name: parsed.food_name,
      brand: parsed.brand,
      quantity: parsed.quantity,
      unit: parsed.unit,
      meal_type: parsed.meal_type,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      message: "Não encontramos informações nutricionais para esse alimento.",
      actions: ["retry", "manual"],
    };
  }

  const finalMatch = detailed ?? finalCandidate ?? candidateList[0];
  return {
    source: "openfoodfacts",
    language: APP_LOCALE,
    parsed,
    matched: true,
    name: String(finalMatch.name ?? parsed.food_name),
    brand: finalMatch.brand ? String(finalMatch.brand) : parsed.brand,
    category: finalMatch.category ? String(finalMatch.category) : parsed.food_type,
    quantity: parsed.quantity ?? Number(finalMatch.quantity ?? 100),
    unit: parsed.unit ?? String(finalMatch.unit ?? "g"),
    meal_type: parsed.meal_type,
    calories: scaleFoodValue(finalMatch.calories, parsed.quantity, parsed.unit),
    protein: scaleFoodValue(finalMatch.protein, parsed.quantity, parsed.unit),
    carbs: scaleFoodValue(finalMatch.carbs, parsed.quantity, parsed.unit),
    fat: scaleFoodValue(finalMatch.fat, parsed.quantity, parsed.unit),
    fiber: finalMatch.fiber == null ? null : Number(finalMatch.fiber),
    sugar: finalMatch.sugar == null ? null : Number(finalMatch.sugar),
    sodium: finalMatch.sodium == null ? null : Number(finalMatch.sodium),
    servings: Array.isArray(finalMatch.servings) ? finalMatch.servings : [],
    food_id: finalMatch.id ? String(finalMatch.id) : "",
    candidates: candidateList,
    message: "Dados nutricionais obtidos diretamente do Open Food Facts.",
  };
}

async function resolveFoodItemsFromText(message: string): Promise<Record<string, unknown>[]> {
  const parts = message
    .split(/\s*,\s*|\s+\be\b\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [await resolveFoodFromText(message)];
  const items: Record<string, unknown>[] = [];
  for (const part of parts) items.push(await resolveFoodFromText(part));
  return items;
}

async function loadContext(supabase: SupabaseClient, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const [profile, goals, preferences, restrictions, meals, logs, settings] = await Promise.all([
    supabase.from("user_profiles").select("goal_type,activity_level,height_cm,current_weight_kg,target_weight_kg,preferred_prep_time_min").eq("user_id", userId).maybeSingle(),
    supabase.from("nutrition_goals").select("goal_type,target_calories,protein_g,carbs_g,fat_g,fiber_g,hydration_ml").eq("user_id", userId).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("dietary_preferences").select("preference_name,preference_value").eq("user_id", userId),
    supabase.from("dietary_restrictions").select("restriction_name,severity,notes").eq("user_id", userId),
    supabase.from("meals").select("id,name,meal_slot,logged_at,source").eq("user_id", userId).order("logged_at", { ascending: false }).limit(20),
    supabase.from("nutrition_logs").select("calories_kcal,protein_g,carbs_g,fat_g,fiber_g,log_date").eq("user_id", userId).eq("log_date", today),
    supabase.from("user_settings").select("safety_notice_enabled").eq("user_id", userId).maybeSingle(),
  ]);

  const firstError = [profile, goals, preferences, restrictions, meals, logs, settings]
    .map((result) => result.error)
    .find(Boolean);
  if (firstError) throw firstError;

  const goal = goals.data;
  const intake = (logs.data ?? []).reduce(
    (total, row) => ({
      calories: total.calories + Number(row.calories_kcal),
      protein: total.protein + Number(row.protein_g),
      carbs: total.carbs + Number(row.carbs_g),
      fat: total.fat + Number(row.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return {
    profile: profile.data,
    goal,
    preferences: preferences.data ?? [],
    restrictions: restrictions.data ?? [],
    recent_meals: meals.data ?? [],
    today_intake: intake,
    remaining: goal
      ? {
          calories: Number(goal.target_calories) - intake.calories,
          protein: Number(goal.protein_g) - intake.protein,
          carbs: Number(goal.carbs_g) - intake.carbs,
          fat: Number(goal.fat_g) - intake.fat,
        }
      : null,
    safety_notice_enabled: settings.data?.safety_notice_enabled ?? true,
  };
}

function buildSystemPrompt(
  context: Awaited<ReturnType<typeof loadContext>>,
  clientProfile?: Record<string, unknown>,
): string {
  return `You are Nutri IA, a supportive nutrition assistant.

SAFETY:
- Provide general nutrition education only. Never diagnose disease, prescribe medication, or claim to replace a doctor or registered dietitian.
- Never recommend starvation, purging, dangerous fasting, unsafe calorie restriction, or unbalanced elimination diets.
- Respect every allergy and restriction as a hard constraint. If the context suggests a medical condition, pregnancy, eating disorder, medication question, or dangerous behavior, return kind professional-care guidance instead of a meal plan.
- Never invent certainty. Nutrition numbers are estimates and must be labeled as estimates.
- Always include this safety message in safety_message: "${safetyMessage}"

BEHAVIOR:
- Use the supplied user context. Do not ask for data already present.
- For questions about remaining calories, protein, hydration, meals, or goals, use only the authoritative server-side context. If it is unavailable, say so instead of guessing.
- Treat client_profile as optional UI context only; never use it to identify a user or override server-side values.
- Optimize for the user's goal, remaining calories/macros, preferences, restrictions, meal history, favorite choices, available ingredients, meal type, budget, and preparation time.
- Give practical, culturally flexible meals. Do not moralize food or use guilt.
- Use metric values unless the profile says otherwise.
- For generate_recipe and estimate_nutrition, infer calories and macros from the food name, description, ingredients, and typical serving size. Never require the user to enter calories manually. Clearly treat all values as estimates.
- For generate_recipe, always return kind "meal", a useful meal_name, non-null numeric calories/protein/carbohydrates/fat, ingredients, and preparation instructions.
- Return ONLY valid JSON matching the response schema. No markdown, no code fences.

USER CONTEXT (authoritative data is loaded server-side for the authenticated user):
${JSON.stringify({ ...context, client_profile: clientProfile?.authorization_granted === true ? clientProfile : null })}`;
}

function buildUserPrompt(input: AiRequest): string {
  return JSON.stringify({
    action: input.action,
    request: input.message ?? null,
    available_ingredients: input.ingredients ?? [],
    meal_type: input.meal_type ?? null,
    preparation_time_minutes: input.preparation_time ?? null,
    servings: input.servings ?? null,
    recipe_to_adapt: input.recipe ?? null,
    personalization_profile: input.profile ?? null,
  });
}

function createGeminiProvider(): Provider {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";

  return {
    async generate({ systemPrompt, userPrompt }) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.35,
              responseMimeType: "application/json",
              responseSchema,
            },
          }),
        },
      );
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as {
          error?: { message?: string; status?: string; code?: number };
        } | null;
        const providerMessage = errorPayload?.error?.message?.trim();
        throw new Error(
          `Gemini ${response.status}${errorPayload?.error?.status ? ` (${errorPayload.error.status})` : ""}: ${
            providerMessage || "request rejected"
          }`,
        );
      }
      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") throw new Error("Gemini returned no structured content");
      const parsed = JSON.parse(text) as AssistantResponse;
      parsed.safety_message = safetyMessage;
      return parsed;
    },
  };
}

async function persistConversation(
  supabase: SupabaseClient,
  userId: string,
  input: AiRequest,
  response: AssistantResponse,
) {
  const conversationId = input.conversation_id ?? (await supabase
    .from("ai_conversations")
    .insert({ user_id: userId, title: "Nutri IA" })
    .select("id")
    .single()).data?.id;

  if (!conversationId) return;
  const { error } = await supabase.from("ai_messages").insert([
    {
      conversation_id: conversationId,
      sender: "user",
      content: input.message ?? JSON.stringify(input),
      response_type: input.action === "chat" ? "conversation" : "meal_suggestion",
      safety_notice: null,
    },
    {
      conversation_id: conversationId,
      sender: "assistant",
      content: response.description,
      response_type: response.kind === "meal" ? "meal_suggestion" : "conversation",
      safety_notice: response.safety_message,
    },
  ]);
  if (error) throw error;
}

async function persistGeneratedMeal(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | undefined,
  response: AssistantResponse,
) {
  if (response.kind !== "meal" || !response.meal_name) return null;
  const { data, error } = await supabase
    .from("ai_generated_meals")
    .insert({
      user_id: userId,
      conversation_id: conversationId ?? null,
      meal_name: response.meal_name,
      calories_kcal: response.calories ?? 0,
      protein_g: response.protein ?? 0,
      carbs_g: response.carbohydrates ?? 0,
      fat_g: response.fat ?? 0,
      prep_time_minutes: response.preparation_time ?? 1,
      ingredients: response.ingredients,
      instructions: response.instructions,
      meal_type: response.tags.includes("breakfast")
        ? "breakfast"
        : response.tags.includes("lunch")
        ? "lunch"
        : response.tags.includes("dinner")
        ? "dinner"
        : null,
      safety_message: response.safety_message,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function addGeneratedMealToPlan(
  supabase: SupabaseClient,
  userId: string,
  generatedMealId: string,
  mealType: string | undefined,
) {
  const { data: generated, error: generatedError } = await supabase
    .from("ai_generated_meals")
    .select("meal_name,meal_type,calories_kcal,protein_g,carbs_g,fat_g")
    .eq("id", generatedMealId)
    .eq("user_id", userId)
    .single();
  if (generatedError) throw generatedError;

  const slot = mealType ?? generated.meal_type ?? "dinner";
  const supportedSlots = new Set(["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack"]);
  if (!supportedSlots.has(slot)) throw new Error("Unsupported meal type");

  const { data: meal, error: mealError } = await supabase
    .from("meals")
    .insert({
      user_id: userId,
      name: generated.meal_name,
      meal_slot: slot,
      source: "ai_generated",
    })
    .select("id")
    .single();
  if (mealError) throw mealError;

  const columnBySlot: Record<string, string> = {
    breakfast: "breakfast_meal_id",
    morning_snack: "morning_snack_meal_id",
    lunch: "lunch_meal_id",
    afternoon_snack: "afternoon_snack_meal_id",
    dinner: "dinner_meal_id",
    evening_snack: "evening_snack_meal_id",
  };
  const planColumn = columnBySlot[slot];
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingPlan, error: planReadError } = await supabase
    .from("daily_meal_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("plan_date", today)
    .maybeSingle();
  if (planReadError) throw planReadError;

  const planPayload = { user_id: userId, plan_date: today, [planColumn]: meal.id };
  const planResult = existingPlan
    ? await supabase.from("daily_meal_plans").update({ [planColumn]: meal.id }).eq("id", existingPlan.id)
    : await supabase.from("daily_meal_plans").insert(planPayload);
  if (planResult.error) throw planResult.error;
  return { meal_id: meal.id, plan_date: today, meal_slot: slot };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  try {
    const input = await request.json() as AiRequest;
    if (!input.action) {
      return new Response(JSON.stringify({ error: "action is required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = getSupabase(request);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: corsHeaders });
    }

    if (isSafetySensitive(input)) {
      const response = safetyResponse();
      await persistConversation(supabase, authData.user.id, input, response);
      return new Response(JSON.stringify(response), { headers: corsHeaders });
    }

    if (input.action === "food_search") {
      const message = (input.food_text ?? input.message ?? "").trim();
      if (!message) {
        return new Response(JSON.stringify({ error: "food_text or message is required" }), { status: 400, headers: corsHeaders });
      }
      try {
        const items = await cachedFoodSearch(message) || await searchFoodWithGemini(message);
        if (!items.length) throw new Error("Gemini não encontrou alimentos para o texto informado");
        await saveFoodSearch(message, items);
        const first = items[0] ?? {};
        return new Response(JSON.stringify({
          ...first,
          items,
          multi_item: items.length > 1,
          safety_message: safetyMessage,
        }), { headers: corsHeaders });
      } catch (error) {
        console.error("Gemini food search failed", error);
        const message = error instanceof Error ? error.message : "Food search failed";
        return new Response(JSON.stringify({
          error: `Não foi possível consultar o Gemini: ${message}`,
          source: "gemini",
          matched: false,
          actions: ["retry", "manual"],
          safety_message: safetyMessage,
        }), { status: 502, headers: corsHeaders });
      }
    }

    if (input.action === "food_barcode") {
      const barcode = (input.barcode ?? "").trim();
      if (!barcode) {
        return new Response(JSON.stringify({ error: "barcode is required" }), { status: 400, headers: corsHeaders });
      }
      try {
        const food = await openFoodFactsService.getFoodByBarcode(barcode);
        return new Response(JSON.stringify({
          source: "openfoodfacts",
          language: APP_LOCALE,
          matched: Boolean(food),
          food,
          message: food ? "Produto encontrado no Open Food Facts." : "Produto não encontrado no Open Food Facts.",
          actions: food ? [] : ["retry", "manual"],
          safety_message: safetyMessage,
        }), { headers: corsHeaders });
      } catch (error) {
        console.error("Open Food Facts barcode lookup unavailable", error);
        return new Response(JSON.stringify({
          source: "openfoodfacts",
          language: APP_LOCALE,
          matched: false,
          unavailable: true,
          food: null,
          message: "Produto não encontrado no Open Food Facts. Pesquise pelo nome ou cadastre-o manualmente.",
          actions: ["retry", "manual"],
          safety_message: safetyMessage,
        }), { status: 503, headers: corsHeaders });
      }
    }

    if (input.action === "add_to_plan") {
      if (!input.generated_meal_id) {
        return new Response(JSON.stringify({ error: "generated_meal_id is required" }), { status: 400, headers: corsHeaders });
      }
      const result = await addGeneratedMealToPlan(
        supabase,
        authData.user.id,
        input.generated_meal_id,
        input.meal_type,
      );
      return new Response(JSON.stringify({ ...result, safety_message: safetyMessage }), { headers: corsHeaders });
    }

    const context = await loadContext(supabase, authData.user.id);
    const provider = createGeminiProvider();
    const response = await provider.generate({
      systemPrompt: buildSystemPrompt(context, input.profile),
      userPrompt: buildUserPrompt(input),
    });
    const generatedMealId = await persistGeneratedMeal(
      supabase,
      authData.user.id,
      input.conversation_id,
      response,
    );
    await persistConversation(supabase, authData.user.id, input, response);

    return new Response(JSON.stringify({ ...response, generated_meal_id: generatedMealId }), { headers: corsHeaders });
  } catch (error) {
    console.error("nutri-ai error", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error
          ? error.message
          : "Não foi possível processar sua solicitação no momento. Tente novamente.",
      }),
      { status: 502, headers: corsHeaders },
    );
  }
});
