// Unidad — Toma exclusiva de servicio por gestor, liberación y estado_toma
// (openspec/changes/toma-exclusiva-servicio-gestor).
//
// No hay infraestructura de tests unitarios de backend (sin pytest/conftest
// en este repo): las tareas 2.2 ("test unitario liberar"), 3.3 ("test
// estado_toma") y 4.2 ("test notificación al tomar") se cubren acá, a nivel
// de API, con el mismo criterio que e2e/despacho.spec.js (que ya prueba
// tomar_servicio y la bandeja).
//
// Contrato bajo prueba:
//   - POST /api/servicios/{id}/liberar → EN_PROCESO -> ASIGNADO; solo el
//     dueño de la toma o un admin; 409 si el estado no es EN_PROCESO o si el
//     que llama no es el dueño; 403 sin uno de los roles habilitados.
//   - ServicioConsultaResponse.estado_toma (schemas.py, computed_field):
//     disponible | tomada | completada | liberada, según estado + asignado_a_id
//     + liberado_at. Se expone en GET /api/ordenes/{id} y en la bandeja.
//   - notificar_toma (notificacion_service.py): solo si la orden tiene
//     veterinario_id y es distinto del gestor que tomó.

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
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestGestor,
  tomarServicio,
  limpiarReferenciasDeGestor,
  listarNotificaciones,
  authHeaders,
  gotoSection,
} = require('./helpers');

/** POST /api/servicios/{id}/liberar. Devuelve la respuesta cruda: varios
 * casos de esta unidad esperan 409/403 a propósito. */
async function liberarServicio(request, servicioId, token) {
  return request.post(`/api/servicios/${servicioId}/liberar`, { headers: authHeaders(token) });
}

/** GET /api/ordenes/{id} con un token cualquiera. Throws on rejection. */
async function obtenerOrden(request, ordenId, token) {
  const res = await request.get(`/api/ordenes/${ordenId}`, { headers: authHeaders(token) });
  if (!res.ok()) {
    throw new Error(`[amivets-e2e] Failed to get orden ${ordenId}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

// limpiarReferenciasDeGestor vive ahora en ./helpers.js (asignacion-directa-
// servicio-gestor, "Working-tree context"): asignacion-directa-servicio-
// gestor.spec.js la necesita igual, y esta unidad sigue usándola sin cambios
// de comportamiento -- solo se movió el código, no la lógica de limpieza.

/** Login por UI (mismo patrón que e2e/orden-veterinario-y-tutores.spec.js). */
async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe.serial('Toma exclusiva de servicio por gestor (toma-exclusiva-servicio-gestor)', () => {
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
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    const vet = await createTestUser(request, S.token, { role: 'veterinario' });
    S.vet = vet;
    S.vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);

    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);

    S.area = await createTestArea(request, S.token, { nombre: testTag('AreaToma') });
    S.catalogo = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', area_id: S.area.id });
    S.gestorA = await createTestGestor(request, S.token);
    S.gestorB = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.area.id, S.gestorA.user.id);
    await agregarGestorArea(request, S.token, S.area.id, S.gestorB.user.id);
  });

  test.afterAll(async ({ request }) => {
    await desactivarTestArea(request, S.token, S.area.id);
    await deleteTestCatalogoServicio(request, S.catalogo.id);
    // S.vet entra también acá (hallazgo de revisión, asignacion-directa-
    // servicio-gestor): cada ordenConServicioAsignado abre una orden CON
    // veterinario, y ordenes_servicio.veterinario_id/abierta_por_id no tiene
    // ondelete -- sin esto, deleteTestUser(S.vet.id) de abajo fallaba en
    // silencio y el veterinario de prueba quedaba huérfano para siempre.
    limpiarReferenciasDeGestor(S.gestorA.user.id, S.gestorB.user.id, S.vet.id);
    await deleteTestUser(request, S.token, S.gestorA.user.id);
    await deleteTestUser(request, S.token, S.gestorB.user.id);
    await deleteTestUser(request, S.token, S.vet.id);
    await deleteTestMascota(request, S.mascota.id);
    await deleteTestPropietario(request, S.propietario.id);
  });

  /** Abre una orden CON veterinario, anexa un servicio despachada al área
   * de toma, confirma (SOLICITADO -> ASIGNADO) y devuelve {orden, servicio}. */
  async function ordenConServicioAsignado(request) {
    const orden = await createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id, veterinarioId: S.vet.id },
      S.vetToken,
    );
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogo.id },
      S.vetToken,
    );
    const confirmada = await confirmarServiciosOrden(request, orden.id, S.vetToken);
    const linea = confirmada.servicios.find((s) => s.id === servicio.id);
    expect(linea.estado).toBe('ASIGNADO');
    return { orden, servicio: linea };
  }

  test('estado_toma: disponible en ASIGNADO recién despachado', async ({ request }) => {
    const { servicio } = await ordenConServicioAsignado(request);
    expect(servicio.estado_toma).toBe('disponible');
    expect(servicio.asignado_a_id ?? null).toBeNull();
  });

  test('gestor A toma el servicio: estado_toma tomada, asignado_a_id = A, y notifica al veterinario', async ({ request }) => {
    const { orden, servicio } = await ordenConServicioAsignado(request);

    const resTomar = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);
    const tomado = await resTomar.json();
    expect(tomado.estado).toBe('EN_PROCESO');
    expect(tomado.asignado_a_id).toBe(S.gestorA.user.id);
    expect(tomado.estado_toma).toBe('tomada');

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === servicio.id);
    expect(linea.estado_toma).toBe('tomada');
    expect(linea.asignado_a_id).toBe(S.gestorA.user.id);

    // notificar_toma: veterinario != tomador → recibe SERVICIO_TOMADO con los
    // datos de la orden (design.md, decisión 3).
    const notifsVet = await listarNotificaciones(request, S.vetToken, { no_leidas: true });
    const notif = notifsVet.find((n) => n.tipo === 'SERVICIO_TOMADO' && n.servicio_id === servicio.id);
    expect(notif).toBeTruthy();
    // GET /api/mascotas devuelve nombre + apellido del propietario pegado
    // (schemas.py::MascotaResponse.append_apellido, quirk preexistente y
    // ajeno a este change); el cuerpo de la notificación lee la columna
    // cruda de la mascota (sin ese apellido pegado) -- se compara contra el
    // nombre real (primer token) para no acoplar el test a ese quirk.
    expect(notif.cuerpo).toContain(S.mascota.nombre.split(' ')[0]);
    expect(notif.cuerpo).toContain(S.propietario.nombre);

    S._servicioTomadoId = servicio.id;
    S._servicioTomadoOrdenId = orden.id;
  });

  test('gestor B intenta tomar el mismo servicio: 409, y no cambia el dueño', async ({ request }) => {
    const res = await tomarServicio(request, S._servicioTomadoId, S.gestorB.token);
    expect(res.status()).toBe(409);

    const ordenLuego = await obtenerOrden(request, S._servicioTomadoOrdenId, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === S._servicioTomadoId);
    expect(linea.asignado_a_id).toBe(S.gestorA.user.id);
    expect(linea.estado_toma).toBe('tomada');
  });

  test('el veterinario mismo tomando su propio servicio no se autonotifica', async ({ request }) => {
    const { servicio } = await ordenConServicioAsignado(request);
    await agregarGestorArea(request, S.token, S.area.id, S.vet.id);

    const antes = await listarNotificaciones(request, S.vetToken, { no_leidas: true });
    const resTomar = await tomarServicio(request, servicio.id, S.vetToken);
    expect(resTomar.ok()).toBe(true);

    const despues = await listarNotificaciones(request, S.vetToken, { no_leidas: true });
    const nuevasParaEsteServicio = despues.filter(
      (n) => n.tipo === 'SERVICIO_TOMADO' && n.servicio_id === servicio.id,
    );
    expect(nuevasParaEsteServicio.length).toBe(0);
    expect(despues.length).toBe(antes.length);
  });

  test('liberar por otro gestor (no dueño): 409 "no es tuyo"', async ({ request }) => {
    const res = await liberarServicio(request, S._servicioTomadoId, S.gestorB.token);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain('no es tuyo');
  });

  test('liberar sin rol habilitado: 403', async ({ request }) => {
    const recepcionista = await createTestUser(request, S.token, { role: 'recepcionista' });
    const token = await loginAs(request, recepcionista.username, TEST_USER_PASSWORD);
    const res = await liberarServicio(request, S._servicioTomadoId, token);
    expect(res.status()).toBe(403);
    await deleteTestUser(request, S.token, recepcionista.id);
  });

  test('gestor A libera su propio servicio: estado_toma liberada, asignado_a_id NULL, y notifica al veterinario', async ({ request }) => {
    const antes = await listarNotificaciones(request, S.vetToken, { no_leidas: true });

    const res = await liberarServicio(request, S._servicioTomadoId, S.gestorA.token);
    expect(res.ok()).toBe(true);
    const liberado = await res.json();
    expect(liberado.estado).toBe('ASIGNADO');
    expect(liberado.asignado_a_id ?? null).toBeNull();
    expect(liberado.estado_toma).toBe('liberada');
    expect(liberado.liberado_at).toBeTruthy();

    const despues = await listarNotificaciones(request, S.vetToken, { no_leidas: true });
    const notif = despues.find((n) => n.tipo === 'SERVICIO_LIBERADO' && n.servicio_id === S._servicioTomadoId);
    expect(notif).toBeTruthy();
    expect(despues.length).toBeGreaterThan(antes.length);
  });

  test('gestor B toma el servicio liberado: estado_toma tomada, asignado_a_id = B', async ({ request }) => {
    const res = await tomarServicio(request, S._servicioTomadoId, S.gestorB.token);
    expect(res.ok()).toBe(true);
    const tomado = await res.json();
    expect(tomado.estado).toBe('EN_PROCESO');
    expect(tomado.asignado_a_id).toBe(S.gestorB.user.id);
    expect(tomado.estado_toma).toBe('tomada');
  });

  test('liberar un servicio que no está en proceso: 409 "solo en proceso"', async ({ request }) => {
    const { servicio } = await ordenConServicioAsignado(request); // sigue ASIGNADO, nunca se tomó
    const res = await liberarServicio(request, servicio.id, S.gestorA.token);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain('en proceso');
  });

  test('admin libera cualquier servicio tomado, sin ser el dueño', async ({ request }) => {
    const res = await liberarServicio(request, S._servicioTomadoId, S.token);
    expect(res.ok()).toBe(true);
    const liberado = await res.json();
    expect(liberado.estado).toBe('ASIGNADO');
    expect(liberado.asignado_a_id ?? null).toBeNull();
    expect(liberado.estado_toma).toBe('liberada');
  });

  test('un servicio EJECUTADO/FACTURADO reporta estado_toma completada', async ({ request }) => {
    const { orden, servicio } = await ordenConServicioAsignado(request);
    const resTomar = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);

    const resEjecutar = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.gestorA.token),
      data: { estado: 'EJECUTADO' },
    });
    expect(resEjecutar.ok()).toBe(true);
    const ejecutado = await resEjecutar.json();
    expect(ejecutado.estado_toma).toBe('completada');

    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === servicio.id);
    expect(linea.estado_toma).toBe('completada');
  });

  test('asignado_a_nombre viaja solo mientras el servicio está tomado (tarea 6.1)', async ({ request }) => {
    const { orden, servicio } = await ordenConServicioAsignado(request);
    expect(servicio.estado_toma).toBe('disponible');
    expect(servicio.asignado_a_nombre ?? null).toBeNull();

    const resTomar = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);
    const tomado = await resTomar.json();
    expect(tomado.estado_toma).toBe('tomada');
    expect(tomado.asignado_a_nombre).toBe(S.gestorA.user.username);

    // GET /api/ordenes/{id} (con eager load de asignado_a, orden_service.py::
    // obtener_orden(con_asignados=True)) también lo trae, sin depender de
    // que Python lo resuelva lazy servicio por servicio.
    const ordenLuego = await obtenerOrden(request, orden.id, S.vetToken);
    const linea = ordenLuego.servicios.find((s) => s.id === servicio.id);
    expect(linea.asignado_a_nombre).toBe(S.gestorA.user.username);

    const resLiberar = await liberarServicio(request, servicio.id, S.gestorA.token);
    expect(resLiberar.ok()).toBe(true);
    const liberado = await resLiberar.json();
    expect(liberado.estado_toma).toBe('liberada');
    expect(liberado.asignado_a_nombre ?? null).toBeNull();
  });

  test('Panel del día: expandir una orden muestra "Tomada por <gestor>" (tarea 6.1)', async ({ page, request }) => {
    const { orden, servicio } = await ordenConServicioAsignado(request);
    const resTomar = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(resTomar.ok()).toBe(true);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-hoy');

    const fila = page.locator(`tr[data-orden-id="${orden.id}"]`);
    await expect(fila).toBeVisible({ timeout: 15000 });

    const toggle = fila.locator('[data-toggle-servicios]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const panel = page.locator(`#pdOrdenServicios-${orden.id}`);
    await expect(panel).toBeHidden();

    // El click-to-abrir-orden de la fila sigue siendo un control separado
    // (stopPropagation en el toggle): expandir NO navega a sec-orden-abierta.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(`Tomada por ${S.gestorA.user.username}`);
    await expect(page.locator('#sec-hoy')).toBeVisible();
  });
});
