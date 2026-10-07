import {
  checkoutSignatureBase,
  issueLicenseToken,
  normalizeAmount,
  normalizePlan,
  resultSignatureBase,
  sha256Hex,
  sortedShp
} from './core.mjs';

const PAYMENT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

function html(body, status = 200) {
  return new Response('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Архиватор ChatGPT</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#17233b}main{border:1px solid #d9e0eb;border-radius:16px;padding:24px}button{padding:10px 14px;border-radius:10px;border:1px solid #b9c6da;background:#fff;color:#17233b;cursor:pointer}textarea{width:100%;box-sizing:border-box;min-height:120px;padding:10px;word-break:break-all}small{color:#667792}.ok{color:#18794e}.bad{color:#b3261e}</style></head><body><main>' + body + '</main></body></html>', { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
async function requestParams(request) {
  const url = new URL(request.url);
  if (request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) return new URLSearchParams(await request.text());
  }
  return url.searchParams;
}
function paymentPassword(env, number) {
  const test = String(env.ROBOKASSA_TEST_MODE || '') === '1';
  return test ? env['ROBOKASSA_TEST_PASSWORD' + number] : env['ROBOKASSA_PASSWORD' + number];
}
async function allocateInvoice(env) {
  for (let i = 0; i < 8; i++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const invId = String((bytes[0] % 2000000000) + 1);
    if (!(await env.PAYMENTS.get('invoice:' + invId))) return invId;
  }
  throw new Error('Could not allocate invoice id.');
}
async function startCheckout(request, env) {
  const url = new URL(request.url);
  const plan = normalizePlan(url.searchParams.get('plan'));
  if (!plan) return html('<h1>Неизвестный тариф</h1>', 400);
  if (!env.ROBOKASSA_MERCHANT_LOGIN || !paymentPassword(env, 1) || !env.PAYMENTS) return html('<h1>Оплата ещё не настроена</h1><p>Магазину не хватает платёжной конфигурации.</p>', 503);

  const invId = await allocateInvoice(env);
  const orderToken = crypto.randomUUID();
  const outSum = plan.amount;
  const shp = ['Shp_order=' + orderToken, 'Shp_plan=' + plan.id];
  const signature = await sha256Hex(checkoutSignatureBase({ merchantLogin: env.ROBOKASSA_MERCHANT_LOGIN, outSum, invId, password1: paymentPassword(env, 1), shp }));

  const order = { orderToken, invId, plan: plan.id, amount: outSum, status: 'pending', createdAt: new Date().toISOString() };
  await env.PAYMENTS.put('order:' + orderToken, JSON.stringify(order));
  await env.PAYMENTS.put('invoice:' + invId, orderToken);

  const fields = { MerchantLogin: env.ROBOKASSA_MERCHANT_LOGIN, OutSum: outSum, InvId: invId, Description: plan.title, SignatureValue: signature, Culture: 'ru', Shp_order: orderToken, Shp_plan: plan.id };
  if (String(env.ROBOKASSA_TEST_MODE || '') === '1') fields.IsTest = '1';
  const inputs = Object.entries(fields).map(([name, value]) => '<input type="hidden" name="' + escapeHtml(name) + '" value="' + escapeHtml(value) + '">').join('');

  return html('<h1>Переходим к оплате</h1><p>' + escapeHtml(plan.title) + ' — <strong>' + escapeHtml(outSum) + ' ₽</strong>.</p><form id="pay" method="post" action="' + PAYMENT_URL + '">' + inputs + '<button type="submit">Перейти в Robokassa</button></form><script>document.getElementById("pay").submit()</script>');
}
async function handleResult(request, env) {
  const params = await requestParams(request);
  const outSumRaw = params.get('OutSum') || '';
  const invId = params.get('InvId') || params.get('InvID') || '';
  const provided = String(params.get('SignatureValue') || '').toUpperCase();
  const password2 = paymentPassword(env, 2);
  if (!outSumRaw || !invId || !provided || !password2) return text('bad request', 400);

  const expected = await sha256Hex(resultSignatureBase({ outSum: outSumRaw, invId, password2, shp: sortedShp(params) }));
  if (expected !== provided) return text('bad signature', 403);

  const orderToken = params.get('Shp_order') || '';
  const planId = params.get('Shp_plan') || '';
  const storedToken = await env.PAYMENTS.get('invoice:' + invId);
  if (!orderToken || storedToken !== orderToken) return text('unknown order', 404);

  const raw = await env.PAYMENTS.get('order:' + orderToken);
  const order = raw ? JSON.parse(raw) : null;
  const plan = normalizePlan(planId);
  if (!order || !plan || order.plan !== plan.id) return text('order mismatch', 409);
  if (normalizeAmount(outSumRaw) !== normalizeAmount(order.amount)) return text('amount mismatch', 409);

  if (order.status !== 'paid' || !order.licenseToken) {
    const issued = await issueLicenseToken({ privateJwk: env.LICENSE_PRIVATE_KEY_JWK, plan: plan.id, licenseId: 'rk-' + invId + '-' + orderToken.slice(0, 8), issuedAt: new Date() });
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.licenseToken = issued.token;
    order.licensePayload = issued.payload;
    await env.PAYMENTS.put('order:' + orderToken, JSON.stringify(order));
  }
  return text('OK' + invId);
}
async function paymentStatus(request, env) {
  const url = new URL(request.url);
  const orderToken = url.searchParams.get('order') || '';
  if (!orderToken) return json({ ok: false, error: 'missing_order' }, 400);
  const raw = await env.PAYMENTS.get('order:' + orderToken);
  if (!raw) return json({ ok: false, error: 'not_found' }, 404);
  const order = JSON.parse(raw);
  return json({ ok: true, status: order.status, plan: order.plan, licenseToken: order.status === 'paid' ? order.licenseToken : '' });
}
async function successPage(request) {
  const params = await requestParams(request);
  const orderToken = params.get('Shp_order') || '';
  if (!orderToken) return html('<h1>Оплата принята</h1><p>Подтверждение платежа обрабатывается.</p>');
  const safe = escapeHtml(orderToken);
  return html('<h1 class="ok">Оплата прошла</h1><p id="state">Получаю лицензию…</p><div id="license" style="display:none"><p>Скопируйте ключ и вставьте его в поле лицензии Архиватора:</p><textarea id="token" readonly></textarea><p><button id="copy">Скопировать ключ</button></p></div><small>Заказ: ' + safe + '</small><script>const order=' + JSON.stringify(orderToken) + ';async function poll(){const r=await fetch("/license/status?order="+encodeURIComponent(order),{cache:"no-store"});const j=await r.json().catch(()=>({}));if(j.status==="paid"&&j.licenseToken){document.getElementById("state").textContent="Лицензия готова.";document.getElementById("token").value=j.licenseToken;document.getElementById("license").style.display="block";return}setTimeout(poll,1200)}document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(document.getElementById("token").value);poll()</script>');
}
function failPage() {
  return html('<h1 class="bad">Оплата не завершена</h1><p>Деньги не были подтверждены. Можно вернуться в Архиватор и попробовать ещё раз.</p>');
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/checkout' && request.method === 'GET') return startCheckout(request, env);
      if (url.pathname === '/robokassa/result' && ['GET', 'POST'].includes(request.method)) return handleResult(request, env);
      if (url.pathname === '/payment/success' && ['GET', 'POST'].includes(request.method)) return successPage(request);
      if (url.pathname === '/payment/fail' && ['GET', 'POST'].includes(request.method)) return failPage();
      if (url.pathname === '/license/status' && request.method === 'GET') return paymentStatus(request, env);
      if (url.pathname === '/health') return json({ ok: true, service: 'chatgpt-archiver-payment' });
      return text('Not found', 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || String(error) }, 500);
    }
  }
};
