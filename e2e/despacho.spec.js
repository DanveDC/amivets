// Unidad — Despacho y bandejas (Tarea 06, FASE 2, etapa 5)
//
// docs/diseno/ordenes-de-servicio.md · decisiones 4, 5, 6, 7 y 9.
//
// Archivo separado de e2e/ordenes.spec.js (que ya pasaba las 700 líneas):
// esta unidad prueba un concepto distinto (despacho al área + notificación +
// bandeja) sobre servicios ya anexados, no el ciclo de vida de la orden en
// sí. Mismo criterio de test.describe.serial y helpers que el resto de la
// suite.
//
// Contrato bajo prueba:
//   - POST   /api/areas/                        → alta de área (admin-only)
//   - GET    /api/areas/                         → admin/recepción/veterinario
//   - PUT    /api/areas/{id}                     → admin-only
//   - POST   /api/areas/{id}/gestores            → admin-only; 409 si ya existe
//   - DELETE /api/areas/{id}/gestores/{usuario}  → admin-only
//   - PUT    /api/catalogo/{id}                  → area_id/requiere_adjunto, admin-only
//   - POST   /api/ordenes/{id}/confirmar         → SOLICITADO -> ASIGNADO dispara
//     Notificacion SERVICIO_ASIGNADO a cada gestor activo; sin gestores, notifica
//     admins (SERVICIO_SIN_GESTOR) + advertencias[] en la respuesta.
//   - POST   /api/servicios/{id}/tomar           → ASIGNADO -> EN_PROCESO; 403 si
//     el usuario no es gestor de esa área; 409 si ya lo tomó otro.
//   - PATCH  /api/servicios/{id}                 → EN_PROCESO -> EJECUTADO (fila 11);
//     422 si el área exige adjunto y no hay ninguno vivo (decisión 7: "la
//     transición devuelve 422 con el mensaje exacto de qué falta" -- esta
//     unidad usaba 409 hasta que existió el endpoint de upload de etapa 6;
//     ver e2e/adjuntos.spec.js para el detalle de la corrección).
//   - GET    /api/servicios/bandeja               → cola del gestor logueado.
//   - GET    /api/notificaciones/, PATCH .../leer, PATCH .../leer-todas.
//
// El endpoint de upload real (POST /api/servicios/{id}/adjuntos, etapa 6)
// vive en e2e/adjuntos.spec.js, que reutiliza el criterio de fixtures de
// esta unidad. Acá, ambas ramas del candado de requiere_adjunto: rechazo
// (sin ningún Adjunto vivo) y éxito (con un adjunto real subido).

const { test, expect } = require('@playwright/test');
const {
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
  listarBandeja,
  listarNotificaciones,
  authHeaders,
  subirAdjunto,
} = require('./helpers');

test.describe.serial('Despacho y bandejas (Tarea 06, etapa 5)', () => {
  const S = {
    token: null,          // admin
    vet: null,
    vetToken: null,
    propietario: null,
    mascota: null,
    areaConGestor: null,
    catalogoConGestor: null,
    gestorA: null,         // gestor de areaConGestor
    gestorB: null,         // segundo gestor de areaConGestor
    areaSinGestor: null,
    catalogoSinGestor: null,
    areaAjena: null,       // área de la que gestorA NO es gestor
    catalogoAjena: null,
    gestorAjeno: null,     // gestor de areaAjena
    areaConAdjunto: null,
    catalogoConAdjunto: null,
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    const vet = await createTestUser(request, S.token, { role: 'veterinario' });
    S.vet = vet;
    S.vetToken = await loginAs(request, vet.username, TEST_USER_PASSWORD);

    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);

    S.areaConGestor = await createTestArea(request, S.token, { nombre: testTag('AreaConGestor') });
    S.catalogoConGestor = await createTestCatalogoServicio(request, {
      categoria: 'LABORATORIO',
      area_id: S.areaConGestor.id,
    });
    S.gestorA = await createTestGestor(request, S.token);
    S.gestorB = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.areaConGestor.id, S.gestorA.user.id);
    await agregarGestorArea(request, S.token, S.areaConGestor.id, S.gestorB.user.id);

    S.areaSinGestor = await createTestArea(request, S.token, { nombre: testTag('AreaSinGestor') });
    S.catalogoSinGestor = await createTestCatalogoServicio(request, {
      categoria: 'LABORATORIO',
      area_id: S.areaSinGestor.id,
    });

    S.areaAjena = await createTestArea(request, S.token, { nombre: testTag('AreaAjena') });
    S.catalogoAjena = await createTestCatalogoServicio(request, {
      categoria: 'IMAGEN',
      area_id: S.areaAjena.id,
    });
    S.gestorAjeno = await createTestGestor(request, S.token);
    await agregarGestorArea(request, S.token, S.areaAjena.id, S.gestorAjeno.user.id);

    S.areaConAdjunto = await createTestArea(request, S.token, {
      nombre: testTag('AreaConAdjunto'),
      requiere_adjunto: true,
    });
    S.catalogoConAdjunto = await createTestCatalogoServicio(request, {
      categoria: 'IMAGEN',
      area_id: S.areaConAdjunto.id,
    });
    await agregarGestorArea(request, S.token, S.areaConAdjunto.id, S.gestorA.user.id);
  });

  test.afterAll(async ({ request }) => {
    await desactivarTestArea(request, S.token, S.areaConGestor.id);
    await desactivarTestArea(request, S.token, S.areaSinGestor.id);
    await desactivarTestArea(request, S.token, S.areaAjena.id);
    await desactivarTestArea(request, S.token, S.areaConAdjunto.id);
    await deleteTestCatalogoServicio(request, S.catalogoConGestor.id);
    await deleteTestCatalogoServicio(request, S.catalogoSinGestor.id);
    await deleteTestCatalogoServicio(request, S.catalogoAjena.id);
    await deleteTestCatalogoServicio(request, S.catalogoConAdjunto.id);
    await deleteTestUser(request, S.token, S.gestorA.user.id);
    await deleteTestUser(request, S.token, S.gestorB.user.id);
    await deleteTestUser(request, S.token, S.gestorAjeno.user.id);
    await deleteTestUser(request, S.token, S.vet.id);
    await deleteTestMascota(request, S.mascota.id);
    await deleteTestPropietario(request, S.propietario.id);
  });

  test('un endpoint protegido nuevo rechaza sin token (401)', async ({ request }) => {
    const res = await request.post('/api/areas/', { data: { codigo: 'X', nombre: 'X' } });
    expect(res.status()).toBe(401);
  });

  test('CRUD de áreas: solo admin da de alta / edita / gestiona gestores', async ({ request }) => {
    const resVet = await request.post('/api/areas/', {
      headers: authHeaders(S.vetToken),
      data: { codigo: testTag('NOPE'), nombre: 'No debería poder' },
    });
    expect(resVet.status()).toBe(403);

    const resDup = await request.post('/api/areas/', {
      headers: authHeaders(S.token),
      data: { codigo: S.areaConGestor.codigo, nombre: 'Duplicada' },
    });
    expect(resDup.status()).toBe(409);

    const resGestorDup = await request.post(`/api/areas/${S.areaConGestor.id}/gestores`, {
      headers: authHeaders(S.token),
      data: { usuario_id: S.gestorA.user.id },
    });
    expect(resGestorDup.status()).toBe(409);
  });

  test('catálogo: area_id / requiere_adjunto son admin-only', async ({ request }) => {
    const resVet = await request.put(`/api/catalogo/${S.catalogoConGestor.id}`, {
      headers: authHeaders(S.vetToken),
      data: { requiere_adjunto: true },
    });
    expect(resVet.status()).toBe(403);

    const resAreaInvalida = await request.put(`/api/catalogo/${S.catalogoConGestor.id}`, {
      headers: authHeaders(S.token),
      data: { area_id: 999999 },
    });
    expect(resAreaInvalida.status()).toBe(400);
  });

  test('confirmar con área asignada notifica a cada gestor activo del área', async ({ request }) => {
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.vetToken);
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogoConGestor.id },
      S.vetToken,
    );
    expect(servicio.estado).toBe('SOLICITADO');

    // orden-servicio-carrito, decisiones 3-5: anexar NO despacha ni mueve la
    // orden -- el carrito sigue ABIERTA y sin notificaciones hasta confirmar.
    const antesDeConfirmar = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.vetToken),
    })).json();
    expect(antesDeConfirmar.estado).toBe('ABIERTA');
    const sinNotifsAun = await listarNotificaciones(request, S.gestorA.token, { no_leidas: true });
    expect(sinNotifsAun.some((n) => n.servicio_id === servicio.id)).toBe(false);

    const confirmada = await confirmarServiciosOrden(request, orden.id, S.vetToken);
    const linea = confirmada.servicios.find((s) => s.id === servicio.id);
    expect(linea.estado).toBe('ASIGNADO');
    expect(linea.advertencias).toBeFalsy();
    // Confirmar es el punto de despacho Y el que pasa la orden a EN_ATENCION
    // (decisión 5).
    expect(confirmada.estado).toBe('EN_ATENCION');

    const notifsA = await listarNotificaciones(request, S.gestorA.token, { no_leidas: true });
    const notifsB = await listarNotificaciones(request, S.gestorB.token, { no_leidas: true });
    expect(notifsA.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicio.id)).toBe(true);
    expect(notifsB.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicio.id)).toBe(true);

    S._servicioConGestorId = servicio.id;
  });

  test('área sin gestor: notifica admins y aparece en advertencias[]', async ({ request }) => {
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.vetToken);
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogoSinGestor.id },
      S.vetToken,
    );

    const confirmada = await confirmarServiciosOrden(request, orden.id, S.vetToken);
    const linea = confirmada.servicios.find((s) => s.id === servicio.id);
    expect(linea.estado).toBe('ASIGNADO');
    expect(linea.advertencias).toBeTruthy();
    expect(linea.advertencias[0].servicio_id).toBe(servicio.id);
    expect(confirmada.estado).toBe('EN_ATENCION');

    const notifsAdmin = await listarNotificaciones(request, S.token, { no_leidas: true });
    expect(notifsAdmin.some((n) => n.tipo === 'SERVICIO_SIN_GESTOR' && n.servicio_id === servicio.id)).toBe(true);
  });

  test('la bandeja del gestor solo muestra las áreas que tiene asignadas', async ({ request }) => {
    const bandejaA = await listarBandeja(request, S.gestorA.token);
    const bandejaAjeno = await listarBandeja(request, S.gestorAjeno.token);

    expect(bandejaA.some((s) => s.id === S._servicioConGestorId)).toBe(true);
    expect(bandejaA.some((s) => s.area_id === S.areaAjena.id)).toBe(false);
    expect(bandejaAjeno.some((s) => s.id === S._servicioConGestorId)).toBe(false);
  });

  test('un gestor no puede tomar un servicio de un área que no es la suya', async ({ request }) => {
    const res = await tomarServicio(request, S._servicioConGestorId, S.gestorAjeno.token);
    expect(res.status()).toBe(403);
  });

  test('dos gestores tomando el mismo servicio: el segundo recibe 409', async ({ request }) => {
    const primero = await tomarServicio(request, S._servicioConGestorId, S.gestorA.token);
    expect(primero.ok()).toBe(true);
    const primeroBody = await primero.json();
    expect(primeroBody.estado).toBe('EN_PROCESO');

    const segundo = await tomarServicio(request, S._servicioConGestorId, S.gestorB.token);
    expect(segundo.status()).toBe(409);
  });

  test('ejecutar sin el adjunto requerido rechaza con 422', async ({ request }) => {
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.vetToken);
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'IMAGEN', catalogo_servicio_id: S.catalogoConAdjunto.id },
      S.vetToken,
    );
    await confirmarServiciosOrden(request, orden.id, S.vetToken);

    const tomado = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(tomado.ok()).toBe(true);

    const resEjecutar = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.gestorA.token),
      data: { estado: 'EJECUTADO', detalles_clinicos: 'Resultado sin adjuntar' },
    });
    // Decisión 7: entidad inválida para la transición pedida (falta un dato
    // que exige), no un conflicto de estado -- 422, no 409.
    expect(resEjecutar.status()).toBe(422);
    const body = await resEjecutar.json();
    expect(body.detail).toMatch(/adjunto/i);
  });

  test('ejecutar CON el adjunto requerido, ya subido, sí pasa a EJECUTADO', async ({ request }) => {
    const orden = await createTestOrden(request, { propietarioId: S.propietario.id, mascotaId: S.mascota.id }, S.vetToken);
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'IMAGEN', catalogo_servicio_id: S.catalogoConAdjunto.id },
      S.vetToken,
    );
    await confirmarServiciosOrden(request, orden.id, S.vetToken);

    const tomado = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(tomado.ok()).toBe(true);

    // Etapa 6: el gestor que tomó el servicio sube el resultado real antes
    // de ejecutar (fila 16 de la matriz).
    const subida = await subirAdjunto(request, servicio.id, S.gestorA.token);
    expect(subida.ok()).toBe(true);

    const resEjecutar = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.gestorA.token),
      data: { estado: 'EJECUTADO', detalles_clinicos: 'Resultado adjuntado' },
    });
    expect(resEjecutar.ok()).toBe(true);
    const body = await resEjecutar.json();
    expect(body.estado).toBe('EJECUTADO');
  });

  test('recorrido feliz completo: anexar -> confirmar -> notifica -> bandeja -> tomar -> ejecutar', async ({ request }) => {
    // veterinarioId explícito: es el camino primario de
    // notificacion_service.notificar_ejecucion (orden.veterinario_id), no el
    // fallback a abierta_por_id.
    const orden = await createTestOrden(
      request,
      { propietarioId: S.propietario.id, mascotaId: S.mascota.id, veterinarioId: S.vet.id },
      S.vetToken,
    );
    const servicio = await anexarServicioOrden(
      request,
      orden.id,
      { tipo_servicio: 'LABORATORIO', catalogo_servicio_id: S.catalogoConGestor.id },
      S.vetToken,
    );
    expect(servicio.estado).toBe('SOLICITADO');

    // Anexar sola no despacha: la orden sigue ABIERTA hasta confirmar
    // (orden-servicio-carrito, decisiones 3-5).
    const antesDeConfirmar = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.vetToken),
    })).json();
    expect(antesDeConfirmar.estado).toBe('ABIERTA');

    const confirmada = await confirmarServiciosOrden(request, orden.id, S.vetToken);
    expect(confirmada.estado).toBe('EN_ATENCION');

    const notifs = await listarNotificaciones(request, S.gestorA.token, { no_leidas: true });
    expect(notifs.some((n) => n.tipo === 'SERVICIO_ASIGNADO' && n.servicio_id === servicio.id)).toBe(true);

    const bandeja = await listarBandeja(request, S.gestorA.token);
    expect(bandeja.some((s) => s.id === servicio.id)).toBe(true);

    const tomado = await tomarServicio(request, servicio.id, S.gestorA.token);
    expect(tomado.ok()).toBe(true);

    // areaConGestor NO exige adjunto (a propósito): este recorrido prueba el
    // camino sin candado; las dos ramas del candado de requiere_adjunto
    // (rechazo y éxito con adjunto real) están cubiertas arriba.
    const ejecutado = await request.patch(`/api/servicios/${servicio.id}`, {
      headers: authHeaders(S.gestorA.token),
      data: { estado: 'EJECUTADO', detalles_clinicos: 'Resultado OK' },
    });
    expect(ejecutado.ok()).toBe(true);
    const body = await ejecutado.json();
    expect(body.estado).toBe('EJECUTADO');

    // El veterinario de la orden es el destinatario elegido para
    // SERVICIO_EJECUTADO (ver notificacion_service.notificar_ejecucion).
    const notifsVet = await listarNotificaciones(request, S.vetToken, { no_leidas: true });
    expect(notifsVet.some((n) => n.tipo === 'SERVICIO_EJECUTADO' && n.servicio_id === servicio.id)).toBe(true);
  });
});
