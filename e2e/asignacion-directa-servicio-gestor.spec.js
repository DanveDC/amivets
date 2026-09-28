// Unidad — Asignación directa de un servicio a un gestor al confirmar la
// orden (openspec/changes/asignacion-directa-servicio-gestor).
//
// No hay infraestructura de tests unitarios de backend (sin pytest/conftest
// en este repo): toda la cobertura va acá, a nivel de API (fixture `request`
// + `e2e/helpers.js`) y de UI, mismo criterio que
// e2e/toma-exclusiva-servicio-gestor.spec.js.
//
// Contrato bajo prueba:
//   - POST /api/ordenes/{id}/confirmar con cuerpo opcional
//     {asignaciones: [{servicio_id, gestor_id}]} (schemas.py::
//     ConfirmarServiciosRequest, orden_service.py::confirmar_servicios).
//   - GET /api/areas/{id}/gestores-activos (routers/areas.py).
//   - Toma exclusiva de un servicio asignado directamente (routers/
//     servicios.py::tomar_servicio/liberar_servicio/listar_bandeja).
//   - ServicioConsultaResponse.asignado_directo_a_id/_nombre y estado_toma
//     "asignada" (schemas.py).

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  loginAs,
  TEST_USER_PASSWORD,
  testTag,
  createTestUser,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestOrden,
  anexarServicioOrden,
  confirmarServiciosOrden,
  listarGestoresActivos,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestGestor,
  createTestRecepcionista,
  tomarServicio,
  limpiarReferenciasDeGestor,
  listarBandeja,
  listarNotificaciones,
  authHeaders,
  gotoSection,
} = require('./helpers');

/** POST /api/servicios/{id}/liberar. Devuelve la respuesta cruda. */
async function liberarServicio(request, servicioId, token) {
  return request.post(`/api/servicios/${servicioId}/liberar`, { headers: authHeaders(token) });
}

/** GET /api/ordenes/{id}. Throws on rejection. */
async function obtenerOrden(request, ordenId, token) {
  const res = await request.get(`/api/ordenes/${ordenId}`, { headers: authHeaders(token) });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to get orden ${ordenId}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Raw POST /api/ordenes/{id}/confirmar con cuerpo -- para los casos que
 * esperan 422/403 a propósito (confirmarServiciosOrden de helpers.js throws). */
async function confirmarCrudo(request, ordenId, token, asignaciones) {
  return request.post(`/api/ordenes/${ordenId}/confirmar`, {
    headers: authHeaders(token),
    data: { asignaciones },
  });
}

/** Login por UI (mismo patrón que toma-exclusiva-servicio-gestor.spec.js). */
async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe.serial('Asignación directa de servicio a gestor (asignacion-directa-servicio-gestor)', () => {
  const S = {
    token: null,       // admin
    vet: null,
    vetToken: null,
    propietario: null,
    mascota: null,
    area: null,
    catalogo: null,
    gestorA: null,
    gestorB: null,
    gestorAjeno: null, // miembro de OTRA área -- 422 "no gestiona esa área"
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    const vet = await createTestUser(request, S.token, { role: 'veterinario' });
    S.vet = vet;
    S.vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);

    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);

    S.area = await createTestArea(request, S.token, { nombre: testTag('AreaDirecta') });
    S.catalogo = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', area_id: S.area.id });
    S.gestorA = await createTestGestor(request, S.token);
    S.gestorB = await createTestGestor(request, S.token);
    S.gestorAjeno = await createTestGestor(request, S.token); // nunca se agrega a S.area
    await agregarGestorArea(request, S.token, S.area.id, S.gestorA.user.id);
    await agregarGestorArea(request, S.token, S.area.id, S.gestorB.user.id);
  });

  test.afterAll(async ({ request }) => {
    await desactivarTestArea(request, S.token, S.area.id);
    await deleteTestCatalogoServicio(request, S.catalogo.id);
    limpiarReferenciasDeGestor(S.gestorA.user.id, S.gestorB.user.id, S.gestorAjeno.user.id, S.vet.id);
    await deleteTestUser(request, S.token, S.gestorA.user.id);
    await deleteTestUser(request, S.token, S.gestorB.user.id);
    await deleteTestUser(request, S.token, S.gestorAjeno.user.id);
    await deleteTestUser(request, S.token, S.vet.id);
    await deleteTestMascota(request, S.mascota.id);
    await deleteTestPropietario(request, S.propietario.id);
  });

  /** Abre una orden y anexa N servicios SOLICITADO del área de prueba, sin
   * confirmarlos. Devuelve {orden, servicios: [ids]}. */
  async function ordenConServicios(request, cantidad = 1) {
    const orden = await createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id, veterinarioId: S.vet.id },
      S.vetToken,
    );
    const servicios = [];
    for (let i = 0; i < cantidad; i++) {
      const s = await anexarServicioOrden(
        request,
        orden.id,
        { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogo.id, nombre_servicio: testTag('svcDirecto') },
        S.vetToken,
      );
      servicios.push(s.id);
    }
    return { orden, servicios };
  }

  // ── 3.5: confirmar con gestor elegido ──────────────────────────────────────

  test('confirmar sin cuerpo mantiene el fan-out a todo el área', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    const confirmada = await confirmarServiciosOrden(request, orden.id, S.vetToken);
    const linea = confirmada.servicios.find((s) => s.id === servicioId);
    expect(linea.estado).toBe('ASIGNADO');
    expect(linea.asignado_directo_a_id ?? null).toBeNull();
    expect(linea.estado_toma).toBe('disponible');

    const notifsA = await listarNotificaciones(request, S.gestorA.token, { no_leidas: true });
    const notifsB = await listarNotificaciones(request, S.gestorB.token, { no_leidas: true });
    expect(notifsA.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicioId)).toBe(true);
    expect(notifsB.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicioId)).toBe(true);

    // Sigue visible para cualquiera de los dos gestores del área (spec
    // "Servicio despachado al área sigue igual").
    const bandejaA = await listarBandeja(request, S.gestorA.token);
    const bandejaB = await listarBandeja(request, S.gestorB.token);
    expect(bandejaA.some((s) => s.id === servicioId)).toBe(true);
    expect(bandejaB.some((s) => s.id === servicioId)).toBe(true);
  });

  test('confirmar eligiendo un gestor: asignado_directo_a_id, estado_toma "asignada" y notifica solo a él', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    const confirmada = await confirmarServiciosOrden(
      request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }],
    );
    const linea = confirmada.servicios.find((s) => s.id === servicioId);
    expect(linea.estado).toBe('ASIGNADO');
    expect(linea.asignado_directo_a_id).toBe(S.gestorA.user.id);
    expect(linea.asignado_directo_a_nombre).toBe(S.gestorA.user.username);
    expect(linea.estado_toma).toBe('asignada');

    const notifsA = await listarNotificaciones(request, S.gestorA.token, { no_leidas: true });
    const notifsB = await listarNotificaciones(request, S.gestorB.token, { no_leidas: true });
    expect(notifsA.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicioId)).toBe(true);
    expect(notifsB.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicioId)).toBe(false);
  });

  test('mezcla de despachos en la misma orden', async ({ request }) => {
    const { orden, servicios: [directoId, alAreaId] } = await ordenConServicios(request, 2);
    const confirmada = await confirmarServiciosOrden(
      request, orden.id, S.vetToken, [{ servicio_id: directoId, gestor_id: S.gestorA.user.id }],
    );
    const lineaDirecta = confirmada.servicios.find((s) => s.id === directoId);
    const lineaArea = confirmada.servicios.find((s) => s.id === alAreaId);
    expect(lineaDirecta.asignado_directo_a_id).toBe(S.gestorA.user.id);
    expect(lineaArea.asignado_directo_a_id ?? null).toBeNull();
    expect(lineaArea.estado_toma).toBe('disponible');
  });

  test('422 por gestor que no gestiona el área del servicio', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    const res = await confirmarCrudo(request, orden.id, S.vetToken, [
      { servicio_id: servicioId, gestor_id: S.gestorAjeno.user.id },
    ]);
    expect(res.status()).toBe(422);

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    expect(ordenLuego.estado).toBe('ABIERTA');
    expect(ordenLuego.servicios.find((s) => s.id === servicioId).estado).toBe('SOLICITADO');
  });

  test('422 por gestor inactivo', async ({ request }) => {
    const gestorInactivo = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.area.id, gestorInactivo.user.id);
    await request.put(`/api/usuarios/${gestorInactivo.user.id}`, {
      headers: authHeaders(S.token),
      data: { is_active: false },
    });

    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    const res = await confirmarCrudo(request, orden.id, S.vetToken, [
      { servicio_id: servicioId, gestor_id: gestorInactivo.user.id },
    ]);
    expect(res.status()).toBe(422);

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    expect(ordenLuego.servicios.find((s) => s.id === servicioId).estado).toBe('SOLICITADO');

    limpiarReferenciasDeGestor(gestorInactivo.user.id);
    await deleteTestUser(request, S.token, gestorInactivo.user.id);
  });

  test('422 por servicio_id ajeno o que no es SOLICITADO con área', async ({ request }) => {
    // El servicio de la primera orden confirmada ya está ASIGNADO (no
    // SOLICITADO) y pertenece a otra orden: cualquiera de los dos motivos
    // basta para el 422 (design.md, decisión 2).
    const { orden: ordenVieja, servicios: [servicioAjenoId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, ordenVieja.id, S.vetToken);

    const { orden, servicios: [servicioPropio] } = await ordenConServicios(request);
    const res = await confirmarCrudo(request, orden.id, S.vetToken, [
      { servicio_id: servicioAjenoId, gestor_id: S.gestorA.user.id },
    ]);
    expect(res.status()).toBe(422);

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    expect(ordenLuego.servicios.find((s) => s.id === servicioPropio).estado).toBe('SOLICITADO');
  });

  test('422 por servicio_id repetido', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    const res = await confirmarCrudo(request, orden.id, S.vetToken, [
      { servicio_id: servicioId, gestor_id: S.gestorA.user.id },
      { servicio_id: servicioId, gestor_id: S.gestorB.user.id },
    ]);
    expect(res.status()).toBe(422);

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    expect(ordenLuego.servicios.find((s) => s.id === servicioId).estado).toBe('SOLICITADO');
  });

  test('403 al confirmar como recepcionista o gestor', async ({ request }) => {
    const { orden } = await ordenConServicios(request);
    const recep = await createTestRecepcionista(request, S.token);
    const resRecep = await confirmarCrudo(request, orden.id, recep.token, []);
    expect(resRecep.status()).toBe(403);
    const resGestor = await confirmarCrudo(request, orden.id, S.gestorA.token, []);
    expect(resGestor.status()).toBe(403);
    await deleteTestUser(request, S.token, recep.user.id);
  });

  test('gestores-activos excluye inactivos y da 403 a gestor/recepcionista', async ({ request }) => {
    const gestorInactivo = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.area.id, gestorInactivo.user.id);
    await request.put(`/api/usuarios/${gestorInactivo.user.id}`, {
      headers: authHeaders(S.token),
      data: { is_active: false },
    });

    const activos = await listarGestoresActivos(request, S.area.id, S.vetToken);
    const ids = activos.map((g) => g.usuario_id);
    expect(ids).toContain(S.gestorA.user.id);
    expect(ids).toContain(S.gestorB.user.id);
    expect(ids).not.toContain(gestorInactivo.user.id);

    const resGestor = await request.get(`/api/areas/${S.area.id}/gestores-activos`, { headers: authHeaders(S.gestorA.token) });
    expect(resGestor.status()).toBe(403);
    const recep = await createTestRecepcionista(request, S.token);
    const resRecep = await request.get(`/api/areas/${S.area.id}/gestores-activos`, { headers: authHeaders(recep.token) });
    expect(resRecep.status()).toBe(403);
    await deleteTestUser(request, S.token, recep.user.id);

    limpiarReferenciasDeGestor(gestorInactivo.user.id);
    await deleteTestUser(request, S.token, gestorInactivo.user.id);
  });

  // ── 4.4: bandeja, toma y liberación ─────────────────────────────────────────

  test('servicio directo a A: aparece en la bandeja de A y no en la de B', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }]);

    const bandejaA = await listarBandeja(request, S.gestorA.token);
    const bandejaB = await listarBandeja(request, S.gestorB.token);
    expect(bandejaA.some((s) => s.id === servicioId)).toBe(true);
    expect(bandejaB.some((s) => s.id === servicioId)).toBe(false);
  });

  test('B intenta tomar un servicio asignado a A: 409 y sigue asignado a A sin tomar', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }]);

    const res = await tomarServicio(request, servicioId, S.gestorB.token);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain('asignado a otro gestor');

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === servicioId);
    expect(linea.estado).toBe('ASIGNADO');
    expect(linea.asignado_a_id ?? null).toBeNull();
    expect(linea.asignado_directo_a_id).toBe(S.gestorA.user.id);
  });

  test('dos tomar concurrentes de A y B sobre el mismo servicio asignado a A: solo A gana', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }]);

    const [resA, resB] = await Promise.all([
      tomarServicio(request, servicioId, S.gestorA.token),
      tomarServicio(request, servicioId, S.gestorB.token),
    ]);
    expect(resA.ok()).toBe(true);
    expect(resB.status()).toBe(409);

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === servicioId);
    expect(linea.asignado_a_id).toBe(S.gestorA.user.id);
    expect(linea.estado).toBe('EN_PROCESO');
  });

  test('A toma su servicio asignado directamente y puede ejecutarlo', async ({ request }) => {
    const { orden, servicios: [asignado] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: asignado, gestor_id: S.gestorA.user.id }]);

    const resTomar = await tomarServicio(request, asignado, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);
    const tomado = await resTomar.json();
    expect(tomado.estado).toBe('EN_PROCESO');
    expect(tomado.asignado_a_id).toBe(S.gestorA.user.id);
    expect(tomado.asignado_directo_a_id).toBe(S.gestorA.user.id);
    expect(tomado.estado_toma).toBe('tomada');

    const resEjecutar = await request.patch(`/api/servicios/${asignado}`, {
      headers: authHeaders(S.gestorA.token),
      data: { estado: 'EJECUTADO' },
    });
    expect(resEjecutar.ok()).toBe(true);
  });

  test('admin ve el servicio asignado en la bandeja de A y puede tomarlo', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }]);

    const bandejaAdminDeA = await listarBandeja(request, S.token, { usuario_id: S.gestorA.user.id });
    expect(bandejaAdminDeA.some((s) => s.id === servicioId)).toBe(true);

    const res = await tomarServicio(request, servicioId, S.token);
    expect(res.ok()).toBe(true);
    const tomado = await res.json();
    expect(tomado.asignado_a_id).toBe((await getAdminIdOnce(request, S.token)));
  });

  test('A libera un servicio asignado directamente: vuelve al área y B lo puede tomar', async ({ request }) => {
    const { orden, servicios: [servicioId] } = await ordenConServicios(request);
    await confirmarServiciosOrden(request, orden.id, S.vetToken, [{ servicio_id: servicioId, gestor_id: S.gestorA.user.id }]);
    const resTomar = await tomarServicio(request, servicioId, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);

    const resLiberar = await liberarServicio(request, servicioId, S.gestorA.token);
    expect(resLiberar.ok()).toBe(true);
    const liberado = await resLiberar.json();
    expect(liberado.estado).toBe('ASIGNADO');
    expect(liberado.asignado_a_id ?? null).toBeNull();
    expect(liberado.asignado_directo_a_id ?? null).toBeNull();
    expect(liberado.estado_toma).toBe('liberada');
    // liberado_por_id no está expuesto en ServicioConsultaResponse (queda
    // como columna de auditoría en BD, ver toma-exclusiva-servicio-gestor) --
    // liberado_at sí, y ya lo cubre la unidad de ese change.
    expect(liberado.liberado_at).toBeTruthy();

    const bandejaB = await listarBandeja(request, S.gestorB.token);
    expect(bandejaB.some((s) => s.id === servicioId)).toBe(true);

    const resTomarB = await tomarServicio(request, servicioId, S.gestorB.token);
    expect(resTomarB.ok()).toBe(true);
  });

  // Cachea el id del admin (para el assert de "admin toma") sin otro GET /me.
  let _adminId = null;
  async function getAdminIdOnce(request, token) {
    if (_adminId) return _adminId;
    const res = await request.get('/api/usuarios/me', { headers: authHeaders(token) });
    const body = await res.json();
    _adminId = body.id;
    return _adminId;
  }

  // ── 5.4: UI ──────────────────────────────────────────────────────────────

  test('UI: elegir gestor al confirmar pinta "Asignado a A" en la orden, el Panel del día y la bandeja de A', async ({ page, request }) => {
    const orden = await createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id, veterinarioId: S.vet.id },
      S.vetToken,
    );
    const svcDirecto = await anexarServicioOrden(
      request, orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogo.id, nombre_servicio: testTag('svcUiDirecto') },
      S.vetToken,
    );
    const svcAlArea = await anexarServicioOrden(
      request, orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogo.id, nombre_servicio: testTag('svcUiArea') },
      S.vetToken,
    );

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-hoy');
    await page.locator(`tr[data-orden-id="${orden.id}"]`).click();
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();

    const select = page.locator(`[data-asignar-servicio="${svcDirecto.id}"]`);
    await expect(select).toBeVisible({ timeout: 15000 });
    await select.selectOption(String(S.gestorA.user.id));
    await page.click('#btnOaConfirmar');
    await expect(page.locator('.notification-toast', { hasText: /Servicios confirmados/ }).first()).toBeVisible();

    const filaDirecta = page.locator('#oaServiciosBody tr', { hasText: svcDirecto.nombre_servicio });
    await expect(filaDirecta).toContainText(`Asignado a ${S.gestorA.user.username}`);

    // Panel del día: expandir la orden muestra el mismo badge.
    await gotoSection(page, 'sec-hoy');
    const filaOrden = page.locator(`tr[data-orden-id="${orden.id}"]`);
    await expect(filaOrden).toBeVisible({ timeout: 15000 });
    await filaOrden.locator('[data-toggle-servicios]').click();
    const panel = page.locator(`#pdOrdenServicios-${orden.id}`);
    await expect(panel).toContainText(`Asignado a ${S.gestorA.user.username}`);

    // B toma libremente el servicio despachado al área: sigue "Tomada por B".
    const resTomarB = await tomarServicio(request, svcAlArea.id, S.gestorB.token);
    expect(resTomarB.ok()).toBe(true);
    await page.reload();
    await gotoSection(page, 'sec-hoy');
    const filaOrden2 = page.locator(`tr[data-orden-id="${orden.id}"]`);
    await expect(filaOrden2).toBeVisible({ timeout: 15000 });
    await filaOrden2.locator('[data-toggle-servicios]').click();
    await expect(page.locator(`#pdOrdenServicios-${orden.id}`)).toContainText(`Tomada por ${S.gestorB.user.username}`);

    // Bandeja: A ve "Asignado a vos"; B no ve la línea de A.
    const ctxA = await page.context().browser().newContext();
    const pageA = await ctxA.newPage();
    try {
      await loginUI(pageA, S.gestorA.user.username, TEST_USER_PASSWORD);
      await gotoSection(pageA, 'sec-bandeja-gestor');
      const filaBandejaA = pageA.locator('#bgQueueBody tr', { hasText: svcDirecto.nombre_servicio });
      await expect(filaBandejaA).toBeVisible({ timeout: 15000 });
      await expect(filaBandejaA).toContainText('Asignado a vos');
    } finally {
      await ctxA.close();
    }

    const ctxB = await page.context().browser().newContext();
    const pageB = await ctxB.newPage();
    try {
      await loginUI(pageB, S.gestorB.user.username, TEST_USER_PASSWORD);
      await gotoSection(pageB, 'sec-bandeja-gestor');
      await expect(pageB.locator('#bgQueueBody')).not.toContainText(svcDirecto.nombre_servicio);
    } finally {
      await ctxB.close();
    }
  });
});
