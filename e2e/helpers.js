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

// Password every throwaway user created by createTestUser (and its wrappers)
// gets. Exposed so specs that need to log in AS that user (e.g. the
// recepcionista role checks in Tarea 09) don't hard-code the literal.
const TEST_USER_PASSWORD = 'Password123!';

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
 *
 * POST /api/inventario/ exige rol admin desde Tarea 10 (el router no tenía
 * NINGUNA autenticación -- hallazgo de seguridad, hoy corregido). Mismo
 * criterio que createTestFactura: fallback incondicional a token de admin
 * para no tocar los ~15 call sites existentes.
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function createTestProduct(request, overrides = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
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
  const res = await request.post('/api/inventario/', { headers: authHeaders(authToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test product: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test product. Best-effort — never throws.
 * Mismo fallback de token admin que createTestProduct (Tarea 10). */
async function deleteTestProduct(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.delete(`/api/inventario/${id}`, { headers: authHeaders(authToken) });
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
    password: TEST_USER_PASSWORD,
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
// best-effort and never throws.
//
// propietarios/mascotas/citas require a token since Tarea 10 (el router no
// tenía NINGUNA autenticación -- hallazgo de seguridad, hoy corregido:
// admin/recepcionista/veterinario). `consultas` (POST/PUT) y `facturas` ya
// exigían token desde antes (Tarea 06 / la propia Tarea 10 encontró y cerró
// además 5 GET sueltos de consultas.py). Mismo criterio que createTestFactura
// (commit 96484b0): fallback incondicional a token de admin en las funciones
// de creación/borrado para no tocar los ~20 call sites existentes que nunca
// pasaban token.
// ===========================================================================

/** Creates a throwaway propietario via the API. */
async function createTestPropietario(request, overrides = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
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
  const res = await request.post('/api/propietarios/', { headers: authHeaders(authToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test propietario: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test propietario. Best-effort — never throws. */
async function deleteTestPropietario(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.delete(`/api/propietarios/${id}`, { headers: authHeaders(authToken) });
  } catch (_) {
    // best-effort cleanup
  }
}

/** Creates a throwaway mascota tied to `propietarioId` via the API. */
async function createTestMascota(request, propietarioId, overrides = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
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
  const res = await request.post('/api/mascotas/', { headers: authHeaders(authToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test mascota: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (deactivates) a test mascota. Best-effort — never throws. */
async function deleteTestMascota(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.delete(`/api/mascotas/${id}`, { headers: authHeaders(authToken) });
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
async function createTestCita(request, { veterinarioId, propietarioId, mascotaId, ...overrides } = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
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
  const res = await request.post('/api/citas/', { headers: authHeaders(authToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test cita: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-cancels a test cita (DELETE just flips estado to CANCELADA). Best-effort. */
async function cancelTestCita(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.delete(`/api/citas/${id}`, { headers: authHeaders(authToken) });
  } catch (_) {
    // best-effort cleanup
  }
}

/**
 * Opens an orden de servicio (POST /api/ordenes/, Tarea 06 etapa 4).
 * `propietarioId` is mandatory server-side; `mascotaId` is optional (venta de
 * mostrador sin paciente). Roles admin/recepción/veterinario — needs a token.
 * Throws on rejection.
 */
async function createTestOrden(
  request,
  { propietarioId, mascotaId = null, veterinarioId = null, ...overrides } = {},
  token = null,
) {
  const payload = {
    propietario_id: propietarioId,
    mascota_id: mascotaId,
    veterinario_id: veterinarioId,
    motivo_visita: testTag('orden').slice(0, 60),
    ...overrides,
  };
  const res = await request.post('/api/ordenes/', {
    headers: token ? authHeaders(token) : {},
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test orden: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Closes an orden. Best-effort — never throws. */
async function cerrarTestOrden(request, id, token = null) {
  try {
    await request.post(`/api/ordenes/${id}/cerrar`, { headers: token ? authHeaders(token) : {} });
  } catch (_) {
    // best-effort cleanup
  }
}

/** Creates a consulta (/api/consultas) via the API. */
/**
 * Creates a test consulta (POST /api/consultas/). Exige sesión con rol
 * admin/recepción/veterinario desde Tarea 06 (decisión 9, fila 1 "abrir
 * orden"): pasa un token real salvo que el spec esté probando deliberadamente
 * el 401/403 del gate. Throws on rejection.
 *
 * Desde la etapa 4 de Tarea 06 `orden_id` es OBLIGATORIO: no hay consulta
 * fuera de una orden. Para no tocar los ~13 specs que ya usan este helper, la
 * orden se abre acá cuando el caller no pasa `orden_id` explícito: se resuelve
 * el tutor desde la mascota (GET /api/mascotas/{id} ya devuelve
 * propietario_id) y se abre una orden con ese tutor, ese paciente y el mismo
 * veterinario. Un spec que necesite controlar la orden (por ejemplo para
 * probar el candado de cierre) pasa `orden_id` en los overrides.
 */
async function createTestConsulta(request, { mascotaId, veterinarioId, ...overrides } = {}, token = null) {
  let ordenId = overrides.orden_id;
  if (!ordenId) {
    // GET /api/mascotas/{id} exige sesión desde Tarea 10 (antes no tenía
    // ninguna autenticación); se resuelve el token acá arriba para esta
    // llamada interna y para abrir la orden, igual que POST /api/ordenes/.
    const ordenToken = token || (await getAdminToken(request));
    const mascotaRes = await request.get(`/api/mascotas/${mascotaId}`, { headers: authHeaders(ordenToken) });
    if (!mascotaRes.ok()) {
      throw new Error(
        `[amivets-e2e] Could not resolve propietario of mascota ${mascotaId} to open an orden: ` +
        `${mascotaRes.status()} ${await mascotaRes.text()}`
      );
    }
    const mascota = await mascotaRes.json();
    const orden = await createTestOrden(
      request,
      { propietarioId: mascota.propietario_id, mascotaId, veterinarioId },
      ordenToken,
    );
    ordenId = orden.id;
  }

  const payload = {
    mascota_id: mascotaId,
    veterinario_id: veterinarioId,
    orden_id: ordenId,
    motivo: testTag('consulta'),
    sintomas: 'PWTEST sintomas',
    diagnostico: 'PWTEST diagnostico',
    peso: 12.5,
    fecha_consulta: new Date().toISOString(),
    precio_consulta: 25000,
    ...overrides,
  };
  const res = await request.post('/api/consultas/', {
    headers: token ? authHeaders(token) : {},
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test consulta: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Hard-deletes a test consulta. Best-effort — never throws.
 *
 * DELETE /api/consultas/{id} exige admin (get_current_admin) desde la revisión
 * final de Tarea 09 — antes cualquiera podía borrar consultas sin sesión. Pide
 * su propio token en vez de agregar un parámetro a los ~8 call sites. */
async function deleteTestConsulta(request, id) {
  try {
    const token = await getAdminToken(request);
    await request.delete(`/api/consultas/${id}`, { headers: authHeaders(token) });
  } catch (_) {
    // best-effort cleanup
  }
}

// ===========================================================================
// Servicios desde la consulta (Tarea 09, FASE 2)
//   /api/servicios (servicio directo, sin consulta) · alias PATCH/DELETE ·
//   POST /api/consultas/{id}/servicios (anexar) ·
//   POST /api/facturas/from-consulta/{id} (facturar en un paso) ·
//   rol `recepcionista` (no puede anexar servicios clínicos).
//
// Same convention as the rest of this file: "create"/"do" helpers throw loudly
// so a broken contract fails at the setup line; "delete" helpers never throw.
// Anexar/editar/borrar un servicio (`crear_servicio_directo`,
// `actualizar_servicio`, `eliminar_servicio` y sus alias en consultas.py)
// exige sesión desde Tarea 06 (decisión 9, requisito cero de `require_roles`):
// un token es obligatorio salvo que el spec esté probando deliberadamente el
// 401/403 del gate.
// ===========================================================================

/**
 * Logs in as an arbitrary user via /token and returns a bearer token.
 * getAdminToken is the admin-only shortcut; this is the generic form, needed
 * for the recepcionista role checks. Throws on a failed login.
 */
async function loginAs(request, username, password) {
  const res = await request.post('/token', { form: { username, password } });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Could not authenticate as "${username}" (status ${res.status()}).`
    );
  }
  const body = await res.json();
  return body.access_token;
}

/**
 * Creates a throwaway user with the `recepcionista` role (Tarea 09, decisión 7)
 * and logs in as them. Returns { user, token }. A recepcionista may open
 * consultas and attach non-clinical services, but the backend answers 403 on
 * clinical service types (VACUNACION, DESPARASITACION, CIRUGIA, HOSPITALIZACION,
 * LABORATORIO). Delete the user with deleteTestUser in afterAll.
 */
async function createTestRecepcionista(request, adminToken, overrides = {}) {
  const user = await createTestUser(request, adminToken, { role: 'recepcionista', ...overrides });
  const token = await loginAs(request, user.username, TEST_USER_PASSWORD);
  return { user, token };
}

/**
 * Creates a "servicio directo": a ServicioConsulta with consulta_id = NULL that
 * hangs off the mascota (Tarea 09, decisión 1). Requires mascota_id. Defaults to
 * a non-clinical type in "SOLICITADO" so it touches no inventory.
 *
 * POST /api/servicios/ exige sesión con rol admin/recepción/veterinario desde
 * Tarea 06 (decisión 9). `token` es obligatorio salvo que el spec esté
 * probando deliberadamente el 401/403.
 *
 * Desde la etapa 4 de Tarea 06 `orden_id` es OBLIGATORIO acá también (decisión
 * 1: no hay trabajo fuera de una orden). Mismo criterio que createTestConsulta:
 * si el caller no pasa `orden_id` en overrides, se abre una orden nueva
 * resolviendo el tutor desde la mascota.
 */
async function createTestServicioDirecto(request, mascotaId, overrides = {}, token = null) {
  let ordenId = overrides.orden_id;
  if (!ordenId) {
    // GET /api/mascotas/{id} exige sesión desde Tarea 10 -- mismo criterio
    // que createTestConsulta.
    const ordenToken = token || (await getAdminToken(request));
    const mascotaRes = await request.get(`/api/mascotas/${mascotaId}`, { headers: authHeaders(ordenToken) });
    if (!mascotaRes.ok()) {
      throw new Error(
        `[amivets-e2e] Could not resolve propietario of mascota ${mascotaId} to open an orden: ` +
        `${mascotaRes.status()} ${await mascotaRes.text()}`
      );
    }
    const mascota = await mascotaRes.json();
    const orden = await createTestOrden(
      request,
      { propietarioId: mascota.propietario_id, mascotaId },
      ordenToken,
    );
    ordenId = orden.id;
  }

  const payload = {
    mascota_id: mascotaId,
    orden_id: ordenId,
    tipo_servicio: 'ESTETICA',
    nombre_servicio: testTag('servDirecto'),
    cantidad: 1,
    precio_unitario: 6000,
    estado: 'SOLICITADO',
    ...overrides,
  };
  const res = await request.post('/api/servicios/', {
    headers: token ? authHeaders(token) : {},
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create servicio directo: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Attaches a servicio directly to an orden, without a consulta (Tarea 06,
 * etapa 4: POST /api/ordenes/{id}/servicios). It's the sibling of
 * anexarServicioConsulta for orders that have no consulta (venta de
 * mostrador, orden solo de estética). Every service added this way lands in
 * SOLICITADO (orden-servicio-carrito, decisión 3: the order is a
 * carrito/presupuesto — see `anexarServicioOrden`'s new area-based state
 * only kicked in after confirming, not at add time). Throws on rejection.
 */
async function anexarServicioOrden(request, ordenId, overrides = {}, token = null) {
  const payload = {
    tipo_servicio: 'ESTETICA',
    nombre_servicio: testTag('servOrden'),
    cantidad: 1,
    precio_unitario: 6000,
    ...overrides,
  };
  const res = await request.post(`/api/ordenes/${ordenId}/servicios`, {
    headers: token ? authHeaders(token) : {},
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to anexar servicio to orden ${ordenId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Confirms the SOLICITADO services of an orden (Tarea 06, etapa 4:
 * POST /api/ordenes/{id}/confirmar). Returns the parsed JSON body regardless
 * of status — callers check `.status()`-sensitive assertions themselves via
 * the raw response when needed; this helper is for the happy path. Throws on
 * rejection.
 */
async function confirmarServiciosOrden(request, ordenId, token = null) {
  const res = await request.post(`/api/ordenes/${ordenId}/confirmar`, {
    headers: token ? authHeaders(token) : {},
  });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to confirmar servicios of orden ${ordenId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * GET /api/ordenes/{id}/pendientes-facturar (orden-servicio-carrito, decisión 6).
 * Returns the raw response — the "409 sobre orden no cerrada" scenario is
 * about POST /facturar, not this read-only preview, but a caller that wants
 * to assert on status can still do so via `.status()`. Throws on rejection
 * for the common case.
 */
async function pendientesFacturarOrden(request, ordenId, token = null) {
  const res = await request.get(`/api/ordenes/${ordenId}/pendientes-facturar`, {
    headers: token ? authHeaders(token) : {},
  });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to get pendientes-facturar of orden ${ordenId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * POST /api/ordenes/{id}/facturar (orden-servicio-carrito, decisión 6).
 * Returns the raw response — several specs deliberately expect 409 (orden no
 * cerrada, doble facturación), so this does NOT throw on a non-2xx status;
 * callers assert on `.status()` themselves and call `.json()` for the happy
 * path.
 */
async function facturarOrden(request, ordenId, body = {}, token = null) {
  return request.post(`/api/ordenes/${ordenId}/facturar`, {
    headers: token ? authHeaders(token) : {},
    data: body,
  });
}

/**
 * POST /api/caja-rapida/ventas (caja-rapida). `body` is
 * { propietario_id?, metodo_pago, items: [{ tipo, id, cantidad, precio_unitario? }] }.
 * Returns the raw response — specs assert 201/404/409/422/403/401 on
 * `.status()` themselves. Without a token the request goes unauthenticated.
 */
async function ventaRapida(request, body, token = null) {
  return request.post('/api/caja-rapida/ventas', {
    headers: token ? authHeaders(token) : {},
    data: body,
  });
}

// ===========================================================================
// Comisiones por servicio (/api/comisiones) — comisiones-por-servicio.
// All return the raw response: specs assert 200/403/409/422 themselves.
// ===========================================================================

/** PUT /api/comisiones/configuracion { porcentaje_defecto }. */
async function setPorcentajeDefecto(request, token, porcentaje) {
  return request.put('/api/comisiones/configuracion', {
    headers: authHeaders(token),
    data: { porcentaje_defecto: porcentaje },
  });
}

/** PUT /api/comisiones/encargados/{id} { porcentaje } (null = volver al defecto). */
async function setPorcentajeEncargado(request, token, usuarioId, porcentaje) {
  return request.put(`/api/comisiones/encargados/${usuarioId}`, {
    headers: authHeaders(token),
    data: { porcentaje },
  });
}

/** GET /api/comisiones/?encargado_id=&desde=&hasta=. */
async function controlComisiones(request, token, encargadoId, desde = null, hasta = null) {
  const params = { encargado_id: encargadoId };
  if (desde) params.desde = desde;
  if (hasta) params.hasta = hasta;
  return request.get('/api/comisiones/', { headers: authHeaders(token), params });
}

/** POST /api/comisiones/liquidaciones { encargado_id, desde, hasta }. */
async function liquidarComisiones(request, token, encargadoId, desde, hasta) {
  return request.post('/api/comisiones/liquidaciones', {
    headers: authHeaders(token),
    data: { encargado_id: encargadoId, desde, hasta },
  });
}

/** GET /api/caja-rapida/items?q= (caja-rapida). Returns the raw response. */
async function buscarItemsCaja(request, q, token = null) {
  return request.get(`/api/caja-rapida/items?q=${encodeURIComponent(q || '')}&limit=100`, {
    headers: token ? authHeaders(token) : {},
  });
}

/** Soft-deletes (is_deleted=True) a test servicio. Best-effort — never throws.
 * DELETE exige admin/veterinario (Tarea 06, decisión 9); pasa un token para
 * que la limpieza realmente funcione. */
async function deleteTestServicio(request, id, token = null) {
  try {
    await request.delete(`/api/servicios/${id}`, { headers: token ? authHeaders(token) : {} });
  } catch (_) {
    // best-effort cleanup
  }
}

/**
 * Attaches a servicio to an open consulta (POST /api/consultas/{id}/servicios).
 * Exige sesión con rol admin/recepción/veterinario desde Tarea 06 (decisión 9):
 * pasa un token real salvo que el spec esté probando deliberadamente el
 * 401/403 del gate (una llamada sin token ahora devuelve 401, no pasa). Throws
 * on rejection.
 */
async function anexarServicioConsulta(request, consultaId, overrides = {}, token = null) {
  const payload = {
    tipo_servicio: 'PROCEDIMIENTO',
    nombre_servicio: testTag('servAnexado'),
    cantidad: 1,
    precio_unitario: 10000,
    estado: 'SOLICITADO',
    ...overrides,
  };
  const res = await request.post(`/api/consultas/${consultaId}/servicios`, {
    headers: token ? authHeaders(token) : {},
    data: payload,
  });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to anexar servicio to consulta ${consultaId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Emits the factura of a consulta in one step (Tarea 09, decisión 8):
 * POST /api/facturas/from-consulta/{id}. The server builds the detalles from
 * consulta.servicios + the consultation fee and leaves the consulta CERRADA.
 * `body` is the optional cobro payload {metodo_pago,total_pagado,descuento,impuesto}.
 * Throws on rejection.
 */
async function facturarDesdeConsulta(request, consultaId, body = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
  const res = await request.post(`/api/facturas/from-consulta/${consultaId}`, { headers: authHeaders(authToken), data: body });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to facturar desde consulta ${consultaId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

// ===========================================================================
// Catálogo de servicios (/api/catalogo) — admin+veterinario desde Tarea 10
// (antes: escritura con sesión pero sin chequeo de rol; lectura sin
// autenticación alguna en 4 de sus 11 endpoints).
// ===========================================================================

/** Creates a throwaway catalog service via the API. Throws on rejection.
 *
 * POST /api/catalogo/ exige sesión desde la revisión final de Tarea 09 (antes
 * cualquiera podía dar de alta un servicio o bypasear el gate de precio). Pide
 * su propio token en vez de agregar un parámetro a los call sites. */
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
  const token = await getAdminToken(request);
  const res = await request.post('/api/catalogo/', { data: payload, headers: authHeaders(token) });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test catalogo servicio: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Soft-deletes (activo=False) a test catalog service. Best-effort — never throws.
 * DELETE /api/catalogo/{id} exige admin/veterinario desde Tarea 10; pasa un
 * token de admin para que la limpieza realmente funcione. */
async function deleteTestCatalogoServicio(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.delete(`/api/catalogo/${id}`, { headers: authHeaders(authToken) });
  } catch (_) {
    // best-effort cleanup
  }
}

// ===========================================================================
// Despacho y bandejas (/api/areas, /api/servicios/{id}/tomar,
// /api/servicios/bandeja, /api/notificaciones) — Tarea 06, etapa 5.
// ===========================================================================

/** Creates a throwaway área de despacho (admin-only). Throws on rejection. */
async function createTestArea(request, adminToken, overrides = {}) {
  const payload = {
    codigo: testTag('AREA').toUpperCase(),
    nombre: testTag('Área'),
    requiere_adjunto: false,
    activo: true,
    ...overrides,
  };
  const res = await request.post('/api/areas/', { headers: authHeaders(adminToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test área: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Deactivates a test área (PUT activo=false). Best-effort — never throws. */
async function desactivarTestArea(request, adminToken, id) {
  try {
    await request.put(`/api/areas/${id}`, { headers: authHeaders(adminToken), data: { activo: false } });
  } catch (_) {
    // best-effort cleanup
  }
}

/** Adds a usuario as gestor of an área (admin-only). Throws on rejection
 * (a spec that wants to assert the 409 duplicate should catch it itself). */
async function agregarGestorArea(request, adminToken, areaId, usuarioId) {
  const res = await request.post(`/api/areas/${areaId}/gestores`, {
    headers: authHeaders(adminToken),
    data: { usuario_id: usuarioId },
  });
  if (!res.ok()) {
    throw new Error(
      `[amivets-e2e] Failed to add gestor ${usuarioId} to área ${areaId}: ${res.status()} ${await res.text()}`
    );
  }
  return res.json();
}

/**
 * Creates a throwaway user with the `gestor` role and logs in as them.
 * Returns { user, token }, same shape as createTestRecepcionista.
 */
async function createTestGestor(request, adminToken, overrides = {}) {
  const user = await createTestUser(request, adminToken, { role: 'gestor', ...overrides });
  const token = await loginAs(request, user.username, TEST_USER_PASSWORD);
  return { user, token };
}

/** POST /api/servicios/{id}/tomar. Returns the raw response — callers assert
 * on `.status()` themselves, since several specs deliberately expect 403/409. */
async function tomarServicio(request, servicioId, token) {
  return request.post(`/api/servicios/${servicioId}/tomar`, { headers: authHeaders(token) });
}

/** GET /api/servicios/bandeja?area_id=&usuario_id=. Throws on rejection. */
async function listarBandeja(request, token, params = {}) {
  const res = await request.get('/api/servicios/bandeja', { headers: authHeaders(token), params });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to list bandeja: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** GET /api/notificaciones?no_leidas=. Throws on rejection. */
async function listarNotificaciones(request, token, params = {}) {
  const res = await request.get('/api/notificaciones/', { headers: authHeaders(token), params });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to list notificaciones: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

// ===========================================================================
// Adjuntos (/api/servicios/{id}/adjuntos, /api/adjuntos/{id}) — Tarea 06,
// etapa 6. Todos los helpers devuelven la respuesta cruda: varios specs
// prueban deliberadamente 403/404/415, y el que quiere el recorrido feliz
// llama `.json()` él mismo.
// ===========================================================================

/** Un PDF mínimo real: alcanza para pasar la firma `%PDF-` de adjunto_service. */
function pdfBufferValido() {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
}

/** Texto plano cualquiera: no matchea ninguna firma de la lista blanca. */
function bufferNoReconocido() {
  return Buffer.from('esto no es un PDF ni ninguna firma reconocida, es texto plano');
}

/** POST /api/servicios/{id}/adjuntos (multipart real). */
async function subirAdjunto(request, servicioId, token, overrides = {}) {
  const {
    buffer = pdfBufferValido(),
    filename = 'resultado.pdf',
    mimeType = 'application/pdf',
  } = overrides;
  return request.post(`/api/servicios/${servicioId}/adjuntos`, {
    headers: authHeaders(token),
    multipart: { archivo: { name: filename, mimeType, buffer } },
  });
}

/** GET /api/adjuntos/{id}. */
async function descargarAdjunto(request, adjuntoId, token) {
  return request.get(`/api/adjuntos/${adjuntoId}`, { headers: authHeaders(token) });
}

/** DELETE /api/adjuntos/{id} (soft delete). */
async function borrarAdjunto(request, adjuntoId, token) {
  return request.delete(`/api/adjuntos/${adjuntoId}`, { headers: authHeaders(token) });
}

/** GET /api/servicios/{id}/adjuntos. */
async function listarAdjuntosServicio(request, servicioId, token) {
  return request.get(`/api/servicios/${servicioId}/adjuntos`, { headers: authHeaders(token) });
}

// ===========================================================================
// Facturación helper: pay a factura in full so it reaches estado PAGADA
// (Liquidaciones only counts consultas whose factura is PAGADA).
// ===========================================================================

/**
 * Registers a single abono for the full outstanding balance of a factura,
 * flipping it to PAGADA. Returns the refreshed factura. Throws on rejection.
 */
async function pagarFacturaCompleta(request, factura, metodoPago = 'Efectivo', token = null) {
  const authToken = token || (await getAdminToken(request));
  const monto = Number(factura.saldo_pendiente ?? factura.total);
  const res = await request.post(`/api/facturas/${factura.id}/abonar`, {
    headers: authHeaders(authToken),
    data: { monto, metodo_pago: metodoPago, notas: testTag('pagoFull') },
  });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to pay factura ${factura.id}: ${res.status()} ${await res.text()}`);
  }
  const refreshed = await request.get(`/api/facturas/${factura.id}`, { headers: authHeaders(authToken) });
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
// pruebas complementarias. Todos estos POST ya usaban `require_roles("admin",
// "veterinario")`, así que el bug de Tarea 06 (decisión 9) los dejaba pasar
// sin token; con el fix exigen un token real de admin o veterinario. "create"
// helpers throw loudly; there is no cleanup helper for the ones without a
// DELETE route.
// ===========================================================================

/** Applies a vacunación against a consulta + inventory product. Throws on rejection. */
async function createTestVacunacion(request, { consultaId, vacunaId, ...overrides } = {}, token) {
  const payload = {
    consulta_id: consultaId,
    vacuna_id: vacunaId,
    lote: testTag('lote').slice(0, 40),
    ...overrides,
  };
  const res = await request.post('/api/clinico/vacunacion', { headers: authHeaders(token), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test vacunacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Applies a desparasitación against a consulta + inventory product. Throws on rejection. */
async function createTestDesparasitacion(request, { consultaId, productoId, ...overrides } = {}, token) {
  const payload = {
    consulta_id: consultaId,
    producto_id: productoId,
    tipo: 'Interna',
    dosis: '1 ml',
    ...overrides,
  };
  const res = await request.post('/api/clinico/desparasitacion', { headers: authHeaders(token), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test desparasitacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Admits a mascota to hospitalización (/api/hospitalizaciones). Throws on rejection. */
async function createTestHospitalizacion(request, { mascotaId, ...overrides } = {}, token) {
  const payload = {
    mascota_id: mascotaId,
    motivo: testTag('hosp'),
    estado_paciente: 'Estable',
    dias_cama: 2,
    precio_aplicado: 1000,
    ...overrides,
  };
  const res = await request.post('/api/hospitalizaciones/', { headers: authHeaders(token), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test hospitalizacion: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Registers a cirugía report (/api/cirugias). Throws on rejection. */
async function createTestCirugia(request, { mascotaId, ...overrides } = {}, token) {
  const payload = {
    mascota_id: mascotaId,
    tipo_procedimiento: testTag('cirugia').slice(0, 60),
    riesgo_asa: 'II',
    precio_aplicado: 50000,
    ...overrides,
  };
  const res = await request.post('/api/cirugias/', { headers: authHeaders(token), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test cirugia: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Registers a prueba complementaria (/api/pruebas). Throws on rejection. */
async function createTestPrueba(request, { mascotaId, ...overrides } = {}, token) {
  const payload = {
    mascota_id: mascotaId,
    tipo: 'Laboratorio',
    resultado: testTag('resultado'),
    precio_aplicado: 8000,
    ...overrides,
  };
  const res = await request.post('/api/pruebas/', { headers: authHeaders(token), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test prueba: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Hard-deletes a test prueba. Best-effort — never throws.
 * DELETE /api/pruebas/{id} exige admin/veterinario (Tarea 06, decisión 9);
 * pasa un token para que la limpieza realmente funcione. */
async function deleteTestPrueba(request, id, token = null) {
  try {
    await request.delete(`/api/pruebas/${id}`, { headers: token ? authHeaders(token) : {} });
  } catch (_) {
    // best-effort cleanup
  }
}

/** Emits a factura (/api/facturas) via the API. */
/**
 * Creates a test factura (POST /api/facturas/). Exige sesión desde la
 * revisión de etapa 8 (el router nunca tuvo require_roles -- hallazgo de
 * seguridad, hoy corregido): admin/recepcionista/veterinario.
 *
 * A diferencia de createTestConsulta (que exige token desde etapa 4 y todos
 * sus callers ya lo pasaban), NINGUNO de los ~15 call sites de este helper
 * pasaba token -- el endpoint nunca lo había necesitado. Para no tener que
 * tocar los 8 specs que lo usan, el fallback es incondicional: sin token
 * explícito, se resuelve uno de admin acá mismo.
 */
async function createTestFactura(request, { propietarioId, consultaId = null, detalles, ...overrides } = {}, token = null) {
  const authToken = token || (await getAdminToken(request));
  const payload = {
    propietario_id: propietarioId,
    consulta_id: consultaId,
    metodo_pago: 'Efectivo',
    detalles: detalles || [
      { descripcion: testTag('linea'), cantidad: 1, precio_unitario: 1000 },
    ],
    ...overrides,
  };
  const res = await request.post('/api/facturas/', { headers: authHeaders(authToken), data: payload });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to create test factura: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Voids a test factura. Best-effort — never throws. Mismo fallback que createTestFactura. */
async function anularTestFactura(request, id, token = null) {
  try {
    const authToken = token || (await getAdminToken(request));
    await request.post(`/api/facturas/${id}/anular`, { headers: authHeaders(authToken) });
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

/**
 * Navigates the shell to a section by its id (e.g. "sec-inventario").
 * The etapa 7 shell (Tarea 06) replaced the flat `.av-tab` bar with a
 * sidebar of 6 modules (`.av-nav-item` / `.av-nav-sub`, `#avSidebar`) plus a
 * launcher (`sec-inicio`, `.av-launcher-card`) that shows once per session.
 * A handful of sections (Usuarios, Mi perfil, Citas web/QR) still live only
 * in the `.av-usermenu` dropdown.
 *
 * Order of attempts:
 *   1. The sidebar already shows `target` (most direct navigations, and any
 *      module-default section once inside a module screen).
 *   2. We're on the launcher: click the module card that targets `target`
 *      directly, or — if `target` is a sub-item of some OTHER module (e.g.
 *      "sec-bandeja-gestor" hangs off "Servicios") — open each visible
 *      module card in turn until the sidebar reveals it.
 *   3. Fall back to the user-menu dropdown.
 * @param {import('@playwright/test').Page} page
 * @param {string} target section id
 */
async function gotoSection(page, target) {
  const trySidebar = async () => {
    const item = page.locator(`.av-sidebar [data-target="${target}"]`).first();
    if (await item.count() && await item.isVisible()) {
      await item.click();
      return true;
    }
    return false;
  };
  if (await trySidebar()) return;

  const launcherCards = page.locator('.av-launcher-card[data-target]');
  const n = await launcherCards.count();
  if (n) {
    for (let i = 0; i < n; i++) {
      if ((await launcherCards.nth(i).getAttribute('data-target')) === target) {
        await launcherCards.nth(i).click();
        return;
      }
    }
    for (let i = 0; i < n; i++) {
      await launcherCards.nth(i).click();
      if (await trySidebar()) return;
      if (await page.locator(`#${target}`).isVisible().catch(() => false)) return;
      // Not the right module — back to the launcher for the next attempt.
      // No silent catch acá a propósito: si este click falla (el sidebar no
      // está visible, por ejemplo porque la navegación real se rompió), el
      // error real de Playwright tiene que propagarse ahora — antes un
      // `.catch(() => {})` lo tragaba y el loop seguía clickeando
      // `.av-launcher-card` contra una página que todavía mostraba la
      // sección anterior, lo que terminaba en un timeout confuso de
      // "elemento no encontrado" varias líneas más abajo, sin señalar la
      // falla de navegación real (hallazgo de revisión, etapa 7).
      await page.locator('.av-sidebar-brand').click();
    }
  }

  const usermenuTarget = page.locator(`.av-usermenu [data-target="${target}"]`);
  const usermenuSummary = page.locator('.av-usermenu > summary');
  await usermenuSummary.click();
  if (await usermenuTarget.count()) {
    await usermenuTarget.click();
    return;
  }
  await usermenuSummary.click(); // cierra el menú que se acaba de abrir para nada

  // Último recurso (Tarea 06, etapa 8): secciones registradas en router.js
  // pero sin entrada de sidebar/lanzador/usermenu -- ej. sec-propietarios,
  // que sigue viva como ruta alcanzable pero perdió su tab al reemplazarla
  // sec-mascotas como landing del módulo 3. `window.showSection` sigue
  // expuesto exactamente para esto (ver router.js, comentario de cabecera).
  await page.evaluate((id) => window.showSection(id), target);
}

module.exports = {
  BASE_URL,
  TEST_PREFIX,
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  loginAs,
  authHeaders,
  isSupabaseAvailable,
  testTag,
  createTestProduct,
  deleteTestProduct,
  createTestUser,
  deleteTestUser,
  cancelCitaQR,
  deleteHorario,
  gotoSection,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  createTestCita,
  cancelTestCita,
  createTestOrden,
  cerrarTestOrden,
  createTestConsulta,
  deleteTestConsulta,
  createTestRecepcionista,
  createTestServicioDirecto,
  deleteTestServicio,
  anexarServicioConsulta,
  anexarServicioOrden,
  confirmarServiciosOrden,
  pendientesFacturarOrden,
  facturarOrden,
  ventaRapida,
  buscarItemsCaja,
  setPorcentajeDefecto,
  setPorcentajeEncargado,
  controlComisiones,
  liquidarComisiones,
  facturarDesdeConsulta,
  createTestFactura,
  anularTestFactura,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestGestor,
  tomarServicio,
  listarBandeja,
  listarNotificaciones,
  pdfBufferValido,
  bufferNoReconocido,
  subirAdjunto,
  descargarAdjunto,
  borrarAdjunto,
  listarAdjuntosServicio,
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
