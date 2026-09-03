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

// ===========================================================================
// Clinical chain helpers: Propietario -> Mascota -> Cita -> Consulta -> Factura
//
// These mirror the createTestUser/deleteTestUser style: the "create" helpers
// throw loudly if the backend rejects the payload (so a broken contract fails
// the test at the setup line), while every "delete"/cleanup helper is
// best-effort and never throws. The clinical routers (propietarios, mascotas,
// citas, consultas, facturas) have no auth dependency in this stack, so unlike
// createTestUser these do NOT need a bearer token.
// ===========================================================================

/** Creates a throwaway propietario via the API. */
async function createTestPropietario(request, overrides = {}) {
  const tag = testTag('prop');
  const payload = {
    nombre: tag,
    apellido: 'Apellido',
    // cedula is a plain string (5-20 chars). The PWTEST_ audit trail lives on
    // `nombre`; cedula just has to be unique.
    cedula: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    telefono: '099000000',
    email: `${tag}@example.com`,
    direccion: 'Calle Falsa 123',
    ...overrides,
  };
  const res = await request.post('/api/propietarios/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test propietario: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test propietario. Best-effort — never throws. */
async function deleteTestPropietario(request, id) {
  try {
    await request.delete(`/api/propietarios/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/** Creates a throwaway mascota tied to `propietarioId` via the API. */
async function createTestMascota(request, propietarioId, overrides = {}) {
  const tag = testTag('pet');
  const payload = {
    nombre: tag,
    especie: 'Perro',
    raza: 'Mestizo / Otros',
    sexo: 'Macho',
    color: 'Marron',
    peso: 10.0,
    propietario_id: propietarioId,
    ...overrides,
  };
  const res = await request.post('/api/mascotas/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test mascota: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test mascota. Best-effort — never throws. */
async function deleteTestMascota(request, id) {
  try {
    await request.delete(`/api/mascotas/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/**
 * Creates a throwaway user with the `veterinario` role. Consultas and citas
 * both require a real usuarios.id with that exact role, so several flows in
 * this suite need one. Thin wrapper over createTestUser (admin-only endpoint).
 */
async function createTestVeterinario(request, token, overrides = {}) {
  return createTestUser(request, token, { role: 'veterinario', ...overrides });
}

/** Creates a cita in the internal agenda (/api/citas) via the API. */
async function createTestCita(request, { veterinarioId, propietarioId, mascotaId, ...overrides } = {}) {
  const payload = {
    veterinario_id: veterinarioId,
    propietario_id: propietarioId,
    mascota_id: mascotaId,
    // Tomorrow: the router rejects citas whose date is before "today" (UTC).
    fecha_cita: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    tipo: testTag('cita').slice(0, 50),
    observaciones: 'PWTEST cita',
    ...overrides,
  };
  const res = await request.post('/api/citas/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test cita: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-cancels a test cita (DELETE just flips estado to CANCELADA). Best-effort. */
async function cancelTestCita(request, id) {
  try {
    await request.delete(`/api/citas/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/** Creates a consulta (/api/consultas) via the API. */
async function createTestConsulta(request, { mascotaId, veterinarioId, ...overrides } = {}) {
  const payload = {
    mascota_id: mascotaId,
    veterinario_id: veterinarioId,
    motivo: testTag('consulta'),
    sintomas: 'PWTEST sintomas',
    diagnostico: 'PWTEST diagnostico',
    peso: 12.5,
    fecha_consulta: new Date().toISOString(),
    precio_consulta: 25000,
    ...overrides,
  };
  const res = await request.post('/api/consultas/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test consulta: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Hard-deletes a test consulta. Best-effort — never throws. */
async function deleteTestConsulta(request, id) {
  try {
    await request.delete(`/api/consultas/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

// ===========================================================================
// Catálogo de servicios (/api/catalogo) — no auth in this stack.
// ===========================================================================

/** Creates a throwaway catalog service via the API. Throws on rejection. */
async function createTestCatalogoServicio(request, overrides = {}) {
  const payload = {
    nombre: testTag('servicioCat'),
    // A category the create-modal <select> also offers, so the same payload
    // can be produced from the UI.
    categoria: 'LABORATORIO',
    precio_ref: 12345.67,
    precio_variable: false,
    unidad: 'unidad',
    activo: true,
    ...overrides,
  };
  const res = await request.post('/api/catalogo/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test catalogo servicio: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (activo=False) a test catalog service. Best-effort — never throws. */
async function deleteTestCatalogoServicio(request, id) {
  try {
    await request.delete(`/api/catalogo/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

// ===========================================================================
// Facturación helper: pay a factura in full so it reaches estado PAGADA
// (Liquidaciones only counts consultas whose factura is PAGADA).
// ===========================================================================

/**
 * Registers a single abono for the full outstanding balance of a factura,
 * flipping it to PAGADA. Returns the refreshed factura. Throws on rejection.
 */
async function pagarFacturaCompleta(request, factura, metodoPago = 'Efectivo') {
  const monto = Number(factura.saldo_pendiente ?? factura.total);
  const res = await request.post(`/api/facturas/${factura.id}/abonar`, {
    data: { monto, metodo_pago: metodoPago, notas: testTag('pagoFull') },
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to pay factura ${factura.id}: ${res.status()} ${await res.text()}`);
  }
  const refreshed = await request.get(`/api/facturas/${factura.id}`);
  return refreshed.json();
}

// ===========================================================================
// Liquidaciones a veterinarios (/api/liquidaciones) — admin-only endpoints.
// ===========================================================================

/** Sets the per-consulta tariff of a veterinario. Throws on rejection. */
async function setTarifaConsulta(request, token, veterinarioId, tarifa) {
  const res = await request.put(`/api/liquidaciones/tarifa/${veterinarioId}`, {
    headers: authHeaders(token),
    data: { tarifa_consulta: tarifa },
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to set tarifa for vet ${veterinarioId}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

// ===========================================================================
// Notas clínicas (/api/notas) — requires an authenticated user (any role).
// ===========================================================================

/** Creates a clinical note for a mascota. Needs a bearer token. Throws on rejection. */
async function createTestNota(request, token, { mascotaId, ...overrides } = {}) {
  const payload = {
    mascota_id: mascotaId,
    categoria: 'general',
    texto: testTag('nota'),
    ...overrides,
  };
  const res = await request.post('/api/notas/', {
    headers: authHeaders(token),
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test nota: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes a test nota. Best-effort — never throws. */
async function deleteTestNota(request, token, id) {
  try {
    await request.delete(`/api/notas/${id}`, { headers: authHeaders(token) });
  } catch (_) {
    // best-effort cleanup
  }
}

// ===========================================================================
// Clínica extendida: vacunación, desparasitación, hospitalización, cirugía,
// pruebas complementarias. No auth in this stack. "create" helpers throw
// loudly; there is no cleanup helper for the ones without a DELETE route.
// ===========================================================================

/** Applies a vacunación against a consulta + inventory product. Throws on rejection. */
async function createTestVacunacion(request, { consultaId, vacunaId, ...overrides } = {}) {
  const payload = {
    consulta_id: consultaId,
    vacuna_id: vacunaId,
    lote: testTag('lote').slice(0, 40),
    ...overrides,
  };
  const res = await request.post('/api/clinico/vacunacion', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test vacunacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Applies a desparasitación against a consulta + inventory product. Throws on rejection. */
async function createTestDesparasitacion(request, { consultaId, productoId, ...overrides } = {}) {
  const payload = {
    consulta_id: consultaId,
    producto_id: productoId,
    tipo: 'Interna',
    dosis: '1 ml',
    ...overrides,
  };
  const res = await request.post('/api/clinico/desparasitacion', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test desparasitacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Admits a mascota to hospitalización (/api/hospitalizaciones). Throws on rejection. */
async function createTestHospitalizacion(request, { mascotaId, ...overrides } = {}) {
  const payload = {
    mascota_id: mascotaId,
    motivo: testTag('hosp'),
    estado_paciente: 'Estable',
    dias_cama: 2,
    precio_aplicado: 1000,
    ...overrides,
  };
  const res = await request.post('/api/hospitalizaciones/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test hospitalizacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Registers a cirugía report (/api/cirugias). Throws on rejection. */
async function createTestCirugia(request, { mascotaId, ...overrides } = {}) {
  const payload = {
    mascota_id: mascotaId,
    tipo_procedimiento: testTag('cirugia').slice(0, 60),
    riesgo_asa: 'II',
    precio_aplicado: 50000,
    ...overrides,
  };
  const res = await request.post('/api/cirugias/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test cirugia: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Registers a prueba complementaria (/api/pruebas). Throws on rejection. */
async function createTestPrueba(request, { mascotaId, ...overrides } = {}) {
  const payload = {
    mascota_id: mascotaId,
    tipo: 'Laboratorio',
    resultado: testTag('resultado'),
    precio_aplicado: 8000,
    ...overrides,
  };
  const res = await request.post('/api/pruebas/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test prueba: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Hard-deletes a test prueba. Best-effort — never throws. */
async function deleteTestPrueba(request, id) {
  try {
    await request.delete(`/api/pruebas/${id}`);
  } catch (_) {
    // best-effort cleanup
  }
}

/** Emits a factura (/api/facturas) via the API. */
async function createTestFactura(request, { propietarioId, consultaId = null, detalles, ...overrides } = {}) {
  const payload = {
    propietario_id: propietarioId,
    consulta_id: consultaId,
    metodo_pago: 'Efectivo',
    detalles: detalles || [
      { descripcion: testTag('linea'), cantidad: 1, precio_unitario: 1000 },
    ],
    ...overrides,
  };
  const res = await request.post('/api/facturas/', { data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test factura: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Voids a test factura. Best-effort — never throws. */
async function anularTestFactura(request, id) {
  try {
    await request.post(`/api/facturas/${id}/anular`);
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
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  createTestCita,
  cancelTestCita,
  createTestConsulta,
  deleteTestConsulta,
  createTestFactura,
  anularTestFactura,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  pagarFacturaCompleta,
  setTarifaConsulta,
  createTestNota,
  deleteTestNota,
  createTestVacunacion,
  createTestDesparasitacion,
  createTestHospitalizacion,
  createTestCirugia,
  createTestPrueba,
  deleteTestPrueba,
};
