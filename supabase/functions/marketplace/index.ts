import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLANS = {
  free: { amount: 0, frequency: 1, label: "Nutrilev Free" },
  plus: { amount: 19.90, frequency: 1, label: "Nutrilev Plus" },
  "academy-start": { amount: 99, frequency: 1, label: "Academia Start" },
  "academy-pro": { amount: 179, frequency: 1, label: "Academia Pro" },
  "academy-business": { amount: 299, frequency: 1, label: "Academia Business" },
  enterprise: { amount: 449, frequency: 1, label: "Enterprise" },
  monthly: { amount: 19.90, frequency: 1, label: "Nutrilev Plus" },
  annual: { amount: 250, frequency: 12, label: "Nutrilev anual" },
} as const;
const adminEmails = new Set(
  (Deno.env.get("ADMIN_EMAILS") || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return String(value.message || value.details || value.hint || "Erro interno.");
  }
  return "Erro interno.";
}

function checkoutUrl(subscription: Record<string, unknown>) {
  const url = subscription.init_point || subscription.sandbox_init_point;
  if (typeof url !== "string" || !url.startsWith("https://")) {
    throw new Error("Mercado Pago não retornou uma URL de checkout para esta assinatura.");
  }

  return url;
}

function selectedPlan(value: unknown) {
  const key = typeof value === "string" && value in PLANS ? value as keyof typeof PLANS : "plus";
  return PLANS[key];
}

async function createPendingSubscription(request: Request, body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const planKey = typeof body.plan === "string" && body.plan in PLANS ? body.plan : "plus";
  const plan = selectedPlan(planKey);
  if (!email || !fullName) throw new Error("Nome e e-mail são obrigatórios.");
  const { data: pending, error: pendingError } = await admin.from("pending_signups").insert({
    email,
    full_name: fullName,
    plan: planKey,
  }).select("id").single();
  if (pendingError) throw pendingError;
  const landingUrl = Deno.env.get("LANDING_URL");
  if (!landingUrl) throw new Error("LANDING_URL não configurada.");
  const subscription = await mercadoPago("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `Nutrilev - assinatura ${plan.label}`,
      payer_email: email,
      external_reference: pending.id,
      back_url: `${landingUrl}?payment=success&pending=${pending.id}`,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/marketplace`,
      auto_recurring: { frequency: plan.frequency, frequency_type: "months", transaction_amount: plan.amount, currency_id: "BRL" },
      status: "pending",
    }),
  });
  const { error } = await admin.from("pending_signups").update({
    mercadopago_subscription_id: subscription.id,
  }).eq("id", pending.id);
  if (error) throw error;
  return response({ checkout_url: checkoutUrl(subscription), pending_id: pending.id });
}

async function completePendingSignup(request: Request, body: Record<string, unknown>) {
  const pendingId = String(body.pending_id || "");
  const password = String(body.password || "");
  if (!pendingId || password.length < 6) throw new Error("Código de pagamento e senha são obrigatórios.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pendingId)) {
    throw new Error("Link de pagamento inválido. Retorne ao site e inicie o cadastro novamente.");
  }
  const { data: pending, error } = await admin.from("pending_signups")
    .select("id,email,full_name,status,plan,approved_at").eq("id", pendingId).maybeSingle();
  if (error) throw error;
  if (!pending || pending.status !== "approved") throw new Error("O pagamento ainda não foi aprovado.");
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: pending.email,
    password,
    email_confirm: false,
    user_metadata: { full_name: pending.full_name },
  });
  if (createError) throw createError;
  const { error: purchaseError } = await admin.from("apk_purchases").insert({
    user_id: created.user.id,
    plan: pending.plan,
    amount: selectedPlan(pending.plan).amount,
    status: "approved",
    approved_at: pending.approved_at || new Date().toISOString(),
  });
  if (purchaseError) throw purchaseError;
  await admin.from("pending_signups").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", pendingId);
  return response({ completed: true });
}

async function createAdminAccount(request: Request, body: Record<string, unknown>) {
  const adminUser = await authenticatedUser(request);
  if (!adminEmails.has((adminUser.email || "").toLowerCase())) {
    throw new Error("Apenas administradores podem criar contas sem pagamento.");
  }
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const password = String(body.password || "");
  if (!email || !fullName || password.length < 6) {
    throw new Error("Nome, e-mail e senha de pelo menos 6 caracteres são obrigatórios.");
  }
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  let user = created?.user;
  if (createError) {
    const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw createError;
    user = users.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;
    if (!user) throw createError;
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (updateError) throw updateError;
  }
  if (!user) throw new Error("A conta não foi criada.");
  const { error: purchaseError } = await admin.from("apk_purchases").upsert({
    user_id: user.id,
    plan: "free",
    // Admin access is free; the catalog constraint still requires the plan amount.
    amount: PLANS.monthly.amount,
    status: "approved",
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (purchaseError) throw purchaseError;
  return response({ created: true, user_id: user.id });
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Autenticação necessária.");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("Sessão inválida.");
  return data.user;
}

async function mercadoPago(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN não configurado.");
  const result = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    const providerMessage = body?.message || body?.error || body?.cause?.[0]?.description;
    throw new Error(providerMessage
      ? `Mercado Pago retornou ${result.status}: ${providerMessage}`
      : `Mercado Pago retornou ${result.status}.`);
  }
  return body;
}

async function createSubscription(request: Request) {
  const body = await request.json();
  const user = await authenticatedUser(request);
  const planKey = typeof body.plan === "string" && body.plan in PLANS ? body.plan : "plus";
  const plan = selectedPlan(planKey);
  const landingUrl = Deno.env.get("LANDING_URL");
  if (!landingUrl) throw new Error("LANDING_URL não configurada.");
  const externalReference = user.id;
  const subscription = await mercadoPago("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `Nutrilev - assinatura ${plan.label}`,
      payer_email: user.email,
      external_reference: externalReference,
      back_url: `${landingUrl}?payment=success`,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/marketplace`,
      auto_recurring: {
        frequency: plan.frequency,
        frequency_type: "months",
        transaction_amount: plan.amount,
        currency_id: "BRL",
      },
      status: "pending",
    }),
  });
  const { error } = await admin.from("apk_purchases").upsert({
    user_id: user.id,
    mercadopago_subscription_id: subscription.id,
    plan: planKey,
    amount: plan.amount,
    status: "pending",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return response({ checkout_url: checkoutUrl(subscription) });
}

async function access(request: Request) {
  const user = await authenticatedUser(request);
  const { data: purchase, error } = await admin.from("apk_purchases")
    .select("status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  let hasApprovedAccess = purchase?.status === "approved";
  if (!hasApprovedAccess) {
    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .in("plan", ["plus", "monthly", "annual"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subscriptionError && subscriptionError.code !== "42P01" && subscriptionError.code !== "PGRST205") {
      throw subscriptionError;
    }
    hasApprovedAccess = Boolean(subscription);
  }
  if (!hasApprovedAccess) return response({ paid: false });
  const configuredObject = Deno.env.get("APK_OBJECT_NAME");
  const candidates = configuredObject
    ? [configuredObject]
    : ["Nutrilev-debug.apk", "Nutrilev.apk"];
  let signedUrl: string | null = null;
  let apkObject = candidates[0];
  let downloadError: unknown = null;
  for (const candidate of candidates) {
    const result = await admin.storage.from("app-downloads").createSignedUrl(candidate, 300);
    if (!result.error && result.data?.signedUrl) {
      signedUrl = result.data.signedUrl;
      apkObject = candidate;
      break;
    }
    downloadError = result.error;
  }
  if (!signedUrl) throw downloadError || new Error("O arquivo do APK não está disponível.");
  return response({ paid: true, download_url: signedUrl, file_name: apkObject.split("/").pop() || "Nutrilev.apk" });
}

async function webhook(request: Request) {
  const body = await request.json().catch(() => ({}));
  const notificationType = body?.type || body?.topic || new URL(request.url).searchParams.get("type") || new URL(request.url).searchParams.get("topic");
  if (notificationType && notificationType !== "subscription_preapproval" && notificationType !== "preapproval") {
    return response({ received: true });
  }
  const url = new URL(request.url);
  const subscriptionId = body?.data?.id || url.searchParams.get("data.id") || url.searchParams.get("id");
  if (!subscriptionId) return response({ received: true });
  const subscription = await mercadoPago(`/preapproval/${subscriptionId}`);
  const userId = subscription.external_reference;
  const transactionAmount = Number(subscription.auto_recurring?.transaction_amount);
  const planKey = Object.keys(PLANS).find((key) => PLANS[key as keyof typeof PLANS].amount === transactionAmount);
  if (!userId || !planKey) return response({ received: true });
  const status = subscription.status === "authorized" ? "approved"
    : subscription.status === "cancelled" ? "cancelled"
      : subscription.status === "paused" ? "pending"
        : "rejected";
  const { data: pending } = await admin.from("pending_signups").select("id").eq("id", userId).maybeSingle();
  if (pending) {
    await admin.from("pending_signups").update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    }).eq("id", userId);
    return response({ received: true });
  }
  const { error } = await admin.from("apk_purchases").update({
    mercadopago_payment_id: String(subscription.id),
    plan: planKey,
    status,
    approved_at: status === "approved" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (error) throw error;
  return response({ received: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await request.json();
      if (payload.action === "create_pending_subscription") return await createPendingSubscription(request, payload);
      if (payload.action === "complete_pending_signup") return await completePendingSignup(request, payload);
      if (request.headers.has("Authorization")) {
        if (payload.action === "create_admin_account") return await createAdminAccount(request, payload);
        if (payload.action === "create_subscription") return await createSubscription(request);
        if (payload.action === "access") return await access(request);
      }
    }
    return await webhook(request);
  } catch (error) {
    console.error(error);
    const message = errorMessage(error);
    const clientError = /obrigatórios|não foi aprovado|não existe|senha|código|inválido/i.test(message);
    return response({ error: message }, clientError ? 400 : 500);
  }
});
