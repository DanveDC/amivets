// Shared helpers for the AmiVets Playwright suite.
//
// Safety guard: this suite must only ever run against the local Docker
// stack. If BASE_URL doesn't point at localhost/127.0.0.1, everything stops
// before a single request is made — we do not want an accidental run
// against Render or a real Supabase project.

const BASE_URL = process.env.BASE_URL || 'http://localhost';

const host = new URL(BASE_URL).hostname;
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(
    `[amivets-e2e] Refusing to run against "${BASE_URL}". ` +
    'This suite only runs against the local Docker stack (localhost/127.0.0.1). ' +
    'Never point it at production or a real Supabase project.'
  );
}

const TEST_PREFIX = 'PWTEST_';

const ADMIN_CREDENTIALS = { username: 'admin', password: 'admin123' };

/**
 * Logs in via /token and returns a bearer token.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function getAdminToken(request) {
  const res = await request.post('/token', {
    form: { username: ADMIN_CREDENTIALS.username, password: ADMIN_CREDENTIALS.password },
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Could not authenticate as admin (status ${res.status()}). ` +
      'Check that the seed admin user exists (admin/admin123).');
  }
  const body = await res.json();
  return body.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Probes whether Supabase is configured/reachable in this environment.
 * The QR booking flow (horarios + citas-qr) depends entirely on Supabase;
 * if it's not configured, those specific scenarios are skipped with a
 * clear reason instead of failing noisily on every run.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function isSupabaseAvailable(request) {
  const res = await request.get('/api/admin/supabase/health');
  if (!res.ok()) return false;
  const body = await res.json();
  return body.status === 'ok';
}

/** Builds a unique, clearly-tagged test string so cleanup/audits are easy to spot. */
function testTag(label) {
  return `${TEST_PREFIX}${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * Creates a throwaway inventory product for a test via the API.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function createTestProduct(request, overrides = {}) {
  const codigo = testTag('SKU');
  const payload = {
    codigo,
    nombre: testTag('Producto'),
    categoria: 'Medicamento',
    stock_actual: 10,
    stock_minimo: 5,
    precio_unitario: 100,
    ...overrides,
  };
  const res = await request.post('/api/inventario/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test product: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test product. Best-effort — never throws. */
async function deleteTestProduct(request, id) {
  try {
    await request.delete(`/api/inventario/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/**
 * Creates a throwaway local user (admin-only endpoint) for edit-user tests.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} token admin bearer token
 */
async function createTestUser(request, token, overrides = {}) {
  const tag = testTag('user');
  const payload = {
    username: tag,
    email: `${tag}@example.com`,
    password: 'Password123!',
    role: 'user',
    ...overrides,
  };
  const res = await request.post('/api/usuarios/', {
    headers: authHeaders(token),
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test user: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Deletes a test user. Best-effort — never throws. */
async function deleteTestUser(request, token, id) {
  try {
    await request.delete(`/api/usuarios/${id}`, { headers: authHeaders(token) });
  } catch (_) {
    // best-effort cleanup
  }
}

/** Cancels a QR cita (soft "delete" — the API has no hard delete for citas). */
async function cancelCitaQR(request, id) {
  try {
    await request.delete(`/api/admin/supabase/citas-qr/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/** Hard-deletes a Supabase-backed horario. */
async function deleteHorario(request, id) {
  try {
    await request.delete(`/api/admin/supabase/horarios/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

module.exports = {
  BASE_URL,
  TEST_PREFIX,
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  isSupabaseAvailable,
  testTag,
  createTestProduct,
  deleteTestProduct,
  createTestUser,
  deleteTestUser,
  cancelCitaQR,
  deleteHorario,
};
