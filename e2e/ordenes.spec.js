// Unidad — Órdenes de servicio (Tarea 06, FASE 2, etapa 4)
//
// docs/diseno/ordenes-de-servicio.md · decisiones 1, 3, 4 y 9.
//
// La orden es el contenedor de la visita: tutor que paga, paciente (opcional),
// veterinario asignado y las líneas de servicio. Acá se prueba su ciclo de
// vida, el enganche de la consulta y el trabajo anexado directo a la orden.
//
// Contrato bajo prueba:
//   - POST   /api/ordenes/                 → ABIERTA (admin/recepción/veterinario; gestor 403)
//   - PUT    /api/ordenes/{id}/veterinario → asigna/cambia (admin/recepción)
//   - POST   /api/ordenes/{id}/tomar       → ABIERTA -> EN_ATENCION (admin; vet solo si es el asignado)
//   - GET    /api/ordenes/{id}             → cabecera + servicios
//   - GET    /api/ordenes/?estado=A,B      → listado del panel del día (filtros)
//   - POST   /api/ordenes/{id}/servicios   → anexa un servicio SIN consulta (venta de
//     mostrador / orden de estética) al carrito/presupuesto de la orden;
//     rechaza tipo_servicio='CONSULTA' (400); SIEMPRE queda SOLICITADO, tenga
//     o no área, sin consumir inventario y sin mover la orden de ABIERTA
//     (orden-servicio-carrito, decisiones 3 y 4).
//   - POST   /api/ordenes/{id}/confirmar   → SOLICITADO -> ASIGNADO (con área) o
//     EJECUTADO (sin área); idempotente (200 sin cambios si no hay nada en
//     SOLICITADO); pasa la orden ABIERTA -> EN_ATENCION (decisión 5).
//   - POST   /api/ordenes/{id}/cerrar      → bloqueado con servicios SOLICITADO/ASIGNADO/EN_PROCESO
//   - POST   /api/ordenes/{id}/anular      → SOLO admin, motivo obligatorio, terminal
//   - POST   /api/consultas/               → exige orden_id; crea la línea
//     tipo_servicio='CONSULTA' en EJECUTADO y dispara ABIERTA -> EN_ATENCION;
//     una segunda consulta en la misma orden es 409 legible (uq_orden_una_consulta).
//   - POST   /api/servicios/               → servicio directo: orden_id ahora
//     obligatorio (422 sin él, 409 si la orden ya no admite trabajo, 400 si la
//     mascota del servicio no es la de la orden).
//
// Actualización (etapa 5, e2e/despacho.spec.js): el hueco de "no hay endpoint
// para crear AreaServicio / setear CatalogoServicio.area_id" que dejaba
// muerta la rama SOLICITADO -> ASIGNADO ya se cerró (POST /api/areas, PUT
// /api/catalogo/{id} con area_id). Ese archivo cubre despacho al área,
// notificaciones, bandeja del gestor y tomar/ejecutar; acá se deja el resto
// tal como estaba (vista acotada del gestor sobre la orden completa sigue
// pendiente -- no forma parte de la etapa 5, ver docs/tareas/06-...).
//
// Criterio UI vs API: igual que el resto de las unidades clínicas, la regla de
// negocio se ejerce por API — la pantalla de órdenes llega en la etapa 7.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  loginAs,
  authHeaders,
  testTag,
  TEST_USER_PASSWORD,
  createTestUser,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  createTestRecepcionista,
  createTestOrden,
  createTestConsulta,
  deleteTestConsulta,
  anexarServicioConsulta,
  anexarServicioOrden,
  confirmarServiciosOrden,
  pendientesFacturarOrden,
  facturarOrden,
  anularTestFactura,
  createTestFactura,
} = require('./helpers');

// Serial: comparten tutor/paciente/usuarios sembrados una sola vez.
test.describe.serial('Órdenes de servicio (Tarea 06, etapa 4)', () => {
  const S = {
    token: null,        // admin
    vet: null,          // usuario veterinario
    vetToken: null,
    otroVet: null,      // segundo veterinario, para el chequeo de "solo el asignado"
    otroVetToken: null,
    recep: null,        // { user, token }
    gestor: null,       // usuario con rol gestor (no toca órdenes en esta etapa)
    gestorToken: null,
    propietario: null,
    mascota: null,
    consultaIds: [],
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.vet = await createTestVeterinario(request, S.token);
    S.vetToken = await loginAs(request, S.vet.username, TEST_USER_PASSWORD);
    S.otroVet = await createTestVeterinario(request, S.token);
    S.otroVetToken = await loginAs(request, S.otroVet.username, TEST_USER_PASSWORD);
    S.recep = await createTestRecepcionista(request, S.token);
    S.gestor = await createTestUser(request, S.token, { role: 'gestor' });
    S.gestorToken = await loginAs(request, S.gestor.username, TEST_USER_PASSWORD);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
  });

  test.afterAll(async ({ request }) => {
    for (const id of S.consultaIds) await deleteTestConsulta(request, id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
    if (S.recep?.user?.id) await deleteTestUser(request, S.token, S.recep.user.id);
    if (S.gestor?.id) await deleteTestUser(request, S.token, S.gestor.id);
    if (S.otroVet?.id) await deleteTestUser(request, S.token, S.otroVet.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
  });

  // ---------------------------------------------------------------------
  // El caso pedido por el enunciado
  // ---------------------------------------------------------------------
  test('recepción abre una orden y asigna veterinario; el veterinario la ve en su lista', async ({ request }) => {
    // Recepción abre la orden SIN veterinario (el caso real del mostrador).
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
      motivo_visita: testTag('mostrador').slice(0, 60),
    }, S.recep.token);

    expect(orden.estado).toBe('ABIERTA');
    expect(orden.numero).toMatch(/^OS-\d{6}$/);
    expect(orden.veterinario_id).toBeNull();
    expect(orden.abierta_por_id).toBe(S.recep.user.id);
    // El tablero muestra tutor y paciente sin pedir dos endpoints más.
    expect(orden.mascota_nombre).toBeTruthy();
    expect(orden.propietario_nombre).toContain(S.propietario.nombre);

    // Antes de asignar, el veterinario NO la tiene en su lista.
    const antes = await (await request.get(
      `/api/ordenes/?veterinario_id=${S.vet.id}&estado=ABIERTA,EN_ATENCION&limit=500`,
      { headers: authHeaders(S.vetToken) },
    )).json();
    expect(antes.some((o) => o.id === orden.id)).toBe(false);

    // Recepción asigna al veterinario (fila 2 de la matriz).
    const asignada = await request.put(`/api/ordenes/${orden.id}/veterinario`, {
      headers: authHeaders(S.recep.token),
      data: { veterinario_id: S.vet.id },
    });
    expect(asignada.status()).toBe(200);
    expect((await asignada.json()).veterinario_id).toBe(S.vet.id);

    // Ahora sí: el veterinario la ve en su lista del día.
    const despues = await (await request.get(
      `/api/ordenes/?veterinario_id=${S.vet.id}&estado=ABIERTA,EN_ATENCION&limit=500`,
      { headers: authHeaders(S.vetToken) },
    )).json();
    const suya = despues.find((o) => o.id === orden.id);
    expect(suya, 'la orden asignada aparece en la lista del veterinario').toBeTruthy();
    expect(suya.veterinario_id).toBe(S.vet.id);
    expect(suya.veterinario_nombre).toBe(S.vet.username);
    expect(despues.every((o) => o.veterinario_id === S.vet.id)).toBe(true);
    expect(despues.every((o) => ['ABIERTA', 'EN_ATENCION'].includes(o.estado))).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Ciclo de vida: abrir → tomar → cerrar
  // ---------------------------------------------------------------------
  test('abrir → tomar → cerrar: solo el veterinario asignado puede tomarla', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    }, S.recep.token);

    // Un veterinario que NO es el asignado no la puede tomar (fila 3, alcance).
    const ajeno = await request.post(`/api/ordenes/${orden.id}/tomar`, {
      headers: authHeaders(S.otroVetToken),
    });
    expect(ajeno.status()).toBe(403);

    // Recepción tampoco: tomar la orden no está en su fila de la matriz.
    const recepToma = await request.post(`/api/ordenes/${orden.id}/tomar`, {
      headers: authHeaders(S.recep.token),
    });
    expect(recepToma.status()).toBe(403);

    // El asignado sí: ABIERTA -> EN_ATENCION.
    const tomada = await request.post(`/api/ordenes/${orden.id}/tomar`, {
      headers: authHeaders(S.vetToken),
    });
    expect(tomada.status()).toBe(200);
    expect((await tomada.json()).estado).toBe('EN_ATENCION');

    // Tomarla de nuevo es 409: ya no está ABIERTA.
    const doble = await request.post(`/api/ordenes/${orden.id}/tomar`, {
      headers: authHeaders(S.vetToken),
    });
    expect(doble.status()).toBe(409);

    // Cerrar sin trabajo pendiente: 200 y sella fecha_cierre + cerrada_por.
    const cerrada = await request.post(`/api/ordenes/${orden.id}/cerrar`, {
      headers: authHeaders(S.recep.token),
    });
    expect(cerrada.status()).toBe(200);
    const cuerpo = await cerrada.json();
    expect(cuerpo.estado).toBe('CERRADA');
    expect(cuerpo.fecha_cierre).toBeTruthy();
    expect(cuerpo.cerrada_por_id).toBe(S.recep.user.id);

    // Una orden cerrada ya no admite cambios (409, no 500).
    const reasignar = await request.put(`/api/ordenes/${orden.id}/veterinario`, {
      headers: authHeaders(S.recep.token),
      data: { veterinario_id: S.otroVet.id },
    });
    expect(reasignar.status()).toBe(409);
  });

  // ---------------------------------------------------------------------
  // El candado central del diseño (decisión 1, regla 2)
  // ---------------------------------------------------------------------
  test('no se puede cerrar una orden con servicios sin resolver', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    }, S.recep.token);

    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
      orden_id: orden.id,
    }, S.vetToken);
    S.consultaIds.push(consulta.id);

    // Un servicio que queda pedido pero sin ejecutar.
    const pendiente = await anexarServicioConsulta(request, consulta.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('bano'),
      precio_unitario: 4000,
      estado: 'SOLICITADO',
    }, S.vetToken);
    // El servicio anexado a la consulta cuelga de la MISMA orden, o el candado
    // no lo vería.
    expect(pendiente.orden_id).toBe(orden.id);

    const bloqueado = await request.post(`/api/ordenes/${orden.id}/cerrar`, {
      headers: authHeaders(S.token),
    });
    expect(bloqueado.status()).toBe(409);
    const detalle = (await bloqueado.json()).detail;
    expect(detalle).toContain('1 servicio');
    expect(detalle).toContain('SOLICITADO');

    // Resolverlo (ejecutarlo) destraba el cierre.
    const ejecutado = await request.patch(`/api/servicios/${pendiente.id}`, {
      headers: authHeaders(S.vetToken),
      data: { estado: 'EJECUTADO' },
    });
    expect(ejecutado.status()).toBe(200);

    const ok = await request.post(`/api/ordenes/${orden.id}/cerrar`, {
      headers: authHeaders(S.token),
    });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).estado).toBe('CERRADA');
  });

  // ---------------------------------------------------------------------
  // Anular: solo admin (fila 6)
  // ---------------------------------------------------------------------
  test('anular una orden es exclusivo de admin y exige motivo', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    }, S.recep.token);

    for (const [quien, token] of [['recepción', S.recep.token], ['veterinario', S.vetToken]]) {
      const res = await request.post(`/api/ordenes/${orden.id}/anular`, {
        headers: authHeaders(token),
        data: { motivo_anulacion: `intento de ${quien}` },
      });
      expect(res.status(), `${quien} no puede anular`).toBe(403);
    }

    // Sin sesión: 401 (requisito cero de la decisión 9).
    const anonimo = await request.post(`/api/ordenes/${orden.id}/anular`, {
      data: { motivo_anulacion: 'sin token' },
    });
    expect(anonimo.status()).toBe(401);

    // Admin sin motivo: 422.
    const sinMotivo = await request.post(`/api/ordenes/${orden.id}/anular`, {
      headers: authHeaders(S.token),
      data: {},
    });
    expect(sinMotivo.status()).toBe(422);

    // Admin con motivo: 200, queda el rastro de quién y por qué.
    const anulada = await request.post(`/api/ordenes/${orden.id}/anular`, {
      headers: authHeaders(S.token),
      data: { motivo_anulacion: 'El tutor se fue sin atenderse' },
    });
    expect(anulada.status()).toBe(200);
    const cuerpo = await anulada.json();
    expect(cuerpo.estado).toBe('ANULADA');
    expect(cuerpo.motivo_anulacion).toBe('El tutor se fue sin atenderse');
    expect(cuerpo.anulada_por_id).toBeTruthy();

    // ANULADA es terminal: no se vuelve.
    const otraVez = await request.post(`/api/ordenes/${orden.id}/anular`, {
      headers: authHeaders(S.token),
      data: { motivo_anulacion: 'de nuevo' },
    });
    expect(otraVez.status()).toBe(409);
  });

  // ---------------------------------------------------------------------
  // Permisos y validaciones del alta
  // ---------------------------------------------------------------------
  test('alta de orden: gate de rol y validación de tutor/paciente/veterinario', async ({ request }) => {
    const base = { propietario_id: S.propietario.id, mascota_id: S.mascota.id };

    // Sin sesión: 401.
    const anonimo = await request.post('/api/ordenes/', { data: base });
    expect(anonimo.status()).toBe(401);

    // `gestor` no abre órdenes (fila 1 de la matriz).
    const gestor = await request.post('/api/ordenes/', {
      headers: authHeaders(S.gestorToken),
      data: base,
    });
    expect(gestor.status()).toBe(403);

    // Tutor inexistente: 404.
    const sinTutor = await request.post('/api/ordenes/', {
      headers: authHeaders(S.token),
      data: { propietario_id: 99999999 },
    });
    expect(sinTutor.status()).toBe(404);

    // La mascota tiene que ser de ese tutor.
    const otroTutor = await createTestPropietario(request);
    const cruzada = await request.post('/api/ordenes/', {
      headers: authHeaders(S.token),
      data: { propietario_id: otroTutor.id, mascota_id: S.mascota.id },
    });
    expect(cruzada.status()).toBe(400);

    // El veterinario asignado tiene que tener rol veterinario.
    const noVet = await request.post('/api/ordenes/', {
      headers: authHeaders(S.token),
      data: { ...base, veterinario_id: S.recep.user.id },
    });
    expect(noVet.status()).toBe(400);

    // Venta de mostrador: orden sin paciente ni veterinario (decisión 1).
    const mostrador = await createTestOrden(request, {
      propietarioId: otroTutor.id,
      motivo_visita: 'Antipulgas',
    }, S.recep.token);
    expect(mostrador.mascota_id).toBeNull();
    expect(mostrador.veterinario_id).toBeNull();
    expect(mostrador.estado).toBe('ABIERTA');

    await deleteTestPropietario(request, otroTutor.id);
  });

  // ---------------------------------------------------------------------
  // El enganche: la consulta vive dentro de una orden (decisiones 1 y 3)
  // ---------------------------------------------------------------------
  test('POST /api/consultas/ exige una orden viva, crea la línea CONSULTA y pasa la orden a EN_ATENCION', async ({ request }) => {
    // Sin orden_id: 422 (el schema lo exige).
    const sinOrden = await request.post('/api/consultas/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        veterinario_id: S.vet.id,
        motivo: testTag('sinOrden'),
        precio_consulta: 1000,
      },
    });
    expect(sinOrden.status()).toBe(422);

    // Orden inexistente: 404.
    const ordenFantasma = await request.post('/api/consultas/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        veterinario_id: S.vet.id,
        orden_id: 99999999,
        motivo: testTag('fantasma'),
        precio_consulta: 1000,
      },
    });
    expect(ordenFantasma.status()).toBe(404);

    const HONORARIO = 31000;
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    }, S.recep.token);
    expect(orden.estado).toBe('ABIERTA');

    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
      orden_id: orden.id,
      precio_consulta: HONORARIO,
    }, S.vetToken);
    S.consultaIds.push(consulta.id);

    // orden_id derivado (orden-servicio-carrito, decisión 10): sin columna
    // nueva, resuelto vía la línea CONSULTA de sus servicios.
    expect(consulta.orden_id).toBe(orden.id);
    const consultaLeida = await (await request.get(`/api/consultas/${consulta.id}`, {
      headers: authHeaders(S.vetToken),
    })).json();
    expect(consultaLeida.orden_id).toBe(orden.id);

    // Transición automática, sin botón aparte (decisión 1, regla 1).
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.vetToken),
    })).json();
    expect(detalle.estado).toBe('EN_ATENCION');

    // La consulta es una línea más de la orden: CONSULTA, referencia a la
    // consulta, con el honorario, y EJECUTADO directo (atajo sin despacho).
    const lineas = detalle.servicios.filter((s) => s.tipo_servicio === 'CONSULTA' && !s.is_deleted);
    expect(lineas.length).toBe(1);
    expect(lineas[0].referencia_id).toBe(consulta.id);
    expect(lineas[0].consulta_id).toBe(consulta.id);
    expect(lineas[0].precio_unitario).toBe(HONORARIO);
    expect(lineas[0].cantidad).toBe(1);
    expect(lineas[0].estado).toBe('EJECUTADO');

    // Una segunda consulta en la misma orden: 409 legible (uq_orden_una_consulta),
    // no un 500 crudo de integridad.
    const segunda = await request.post('/api/consultas/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        veterinario_id: S.vet.id,
        orden_id: orden.id,
        motivo: testTag('segunda'),
        precio_consulta: 5000,
      },
    });
    expect(segunda.status()).toBe(409);
    expect((await segunda.json()).detail).toContain('una consulta');

    // Cerrada la orden, no admite una consulta nueva: 409.
    const cerrada = await request.post(`/api/ordenes/${orden.id}/cerrar`, {
      headers: authHeaders(S.token),
    });
    expect(cerrada.status()).toBe(200);

    const tardia = await request.post('/api/consultas/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        veterinario_id: S.vet.id,
        orden_id: orden.id,
        motivo: testTag('tardia'),
        precio_consulta: 5000,
      },
    });
    expect(tardia.status()).toBe(409);
  });

  // ---------------------------------------------------------------------
  // Listado: es el que alimenta el panel del día con poll (decisión 6)
  // ---------------------------------------------------------------------
  test('listado de órdenes: filtros por estado múltiple, tutor y paciente', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);

    const abiertas = await (await request.get(
      '/api/ordenes/?estado=ABIERTA,EN_ATENCION&limit=500',
      { headers: authHeaders(S.recep.token) },
    )).json();
    expect(abiertas.some((o) => o.id === orden.id)).toBe(true);
    expect(abiertas.every((o) => ['ABIERTA', 'EN_ATENCION'].includes(o.estado))).toBe(true);

    const porTutor = await (await request.get(
      `/api/ordenes/?propietario_id=${S.propietario.id}&limit=500`,
      { headers: authHeaders(S.recep.token) },
    )).json();
    expect(porTutor.every((o) => o.propietario_id === S.propietario.id)).toBe(true);
    expect(porTutor.some((o) => o.id === orden.id)).toBe(true);

    const porPaciente = await (await request.get(
      `/api/ordenes/?mascota_id=${S.mascota.id}&limit=500`,
      { headers: authHeaders(S.recep.token) },
    )).json();
    expect(porPaciente.every((o) => o.mascota_id === S.mascota.id)).toBe(true);

    // Fecha mal formada: 422, no 500.
    const fechaMala = await request.get('/api/ordenes/?fecha_desde=ayer', {
      headers: authHeaders(S.recep.token),
    });
    expect(fechaMala.status()).toBe(422);

    // Sin sesión: 401. Con rol gestor: 403 (la vista acotada es de la etapa 5).
    expect((await request.get('/api/ordenes/')).status()).toBe(401);
    expect((await request.get('/api/ordenes/', { headers: authHeaders(S.gestorToken) })).status()).toBe(403);
    expect((await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(S.gestorToken) })).status()).toBe(403);
  });

  // ---------------------------------------------------------------------
  // Anexar servicio directo a la orden (decisión 1: venta de mostrador, orden
  // solo de estética) como carrito/presupuesto (orden-servicio-carrito,
  // decisiones 2-5): SIEMPRE SOLICITADO al anexar, EJECUTADO recién al
  // confirmar si no tiene área.
  // ---------------------------------------------------------------------
  test('orden sin consulta: anexa un servicio al carrito (SOLICITADO), confirma (EJECUTADO sin área) y factura', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.total).toBe(0);

    // ESTETICA sin catalogo_servicio_id: sin área conocida. Aun así, agregar
    // al carrito deja el servicio en SOLICITADO -- el atajo "sin área" ahora
    // se resuelve al confirmar, no al anexar (decisión 3).
    const servicio = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('bano'),
      precio_unitario: 8000,
    }, S.recep.token);
    expect(servicio.orden_id).toBe(orden.id);
    expect(servicio.consulta_id).toBeNull();
    expect(servicio.mascota_id).toBe(S.mascota.id);
    expect(servicio.estado).toBe('SOLICITADO');

    // Anexar NO transiciona la orden (decisión 3): sigue ABIERTA, como un
    // carrito, y ya expone el presupuesto acumulado.
    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(detalle.estado).toBe('ABIERTA');
    expect(detalle.total).toBe(8000);

    // Confirmar despacha el atajo sin área a EJECUTADO y recién ahí pasa la
    // orden a EN_ATENCION (decisión 5).
    const confirmada = await request.post(`/api/ordenes/${orden.id}/confirmar`, {
      headers: authHeaders(S.token),
    });
    expect(confirmada.status()).toBe(200);
    const cuerpoConfirmado = await confirmada.json();
    expect(cuerpoConfirmado.estado).toBe('EN_ATENCION');
    const lineaTrasConfirmar = cuerpoConfirmado.servicios.find((s) => s.id === servicio.id);
    expect(lineaTrasConfirmar.estado).toBe('EJECUTADO');

    // Se puede facturar sin haber pasado nunca por una consulta.
    const factura = await createTestFactura(request, {
      propietarioId: S.propietario.id,
      detalles: [
        {
          descripcion: servicio.nombre_servicio,
          cantidad: 1,
          precio_unitario: servicio.precio_unitario,
          servicio_id: servicio.id,
        },
      ],
    });
    expect(factura.total).toBe(8000);
  });

  // ---------------------------------------------------------------------
  // El total del carrito (orden-servicio-carrito, decisión 2)
  // ---------------------------------------------------------------------
  test('el total de la orden acumula por línea y no cuenta canceladas ni borradas', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    expect(orden.total).toBe(0);

    const uno = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('corte'),
      cantidad: 2,
      precio_unitario: 100,
    }, S.recep.token);
    const dos = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('unas'),
      cantidad: 1,
      precio_unitario: 50,
    }, S.recep.token);

    const conDos = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(conDos.total).toBe(250);

    // Cancelar una línea la saca del total (PATCH la mueve a CANCELADO).
    const cancelado = await request.patch(`/api/servicios/${dos.id}`, {
      headers: authHeaders(S.recep.token),
      data: { estado: 'CANCELADO' },
    });
    expect(cancelado.status()).toBe(200);

    const sinDos = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(sinDos.total).toBe(200);

    // El listado también expone el total (mismo cálculo, sin N+1).
    const listado = await (await request.get(
      `/api/ordenes/?propietario_id=${S.propietario.id}&limit=500`,
      { headers: authHeaders(S.recep.token) },
    )).json();
    const fila = listado.find((o) => o.id === orden.id);
    expect(fila.total).toBe(200);
  });

  test('no se puede anexar una línea CONSULTA por POST /api/ordenes/{id}/servicios', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);

    const rechazada = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.vetToken),
      data: { tipo_servicio: 'CONSULTA', nombre_servicio: 'x', precio_unitario: 1000 },
    });
    expect(rechazada.status()).toBe(400);
    expect((await rechazada.json()).detail).toContain('CONSULTA');
  });

  test('anexar servicio a la orden: gate de sesión/rol y el bloqueo de tipos clínicos para recepción', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);

    // Sin token: 401 (requisito cero de la decisión 9).
    const anonimo = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      data: { tipo_servicio: 'ESTETICA', precio_unitario: 1000 },
    });
    expect(anonimo.status()).toBe(401);

    // gestor no anexa: no está en las filas 7-8 de la matriz.
    const gestor = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.gestorToken),
      data: { tipo_servicio: 'ESTETICA', precio_unitario: 1000 },
    });
    expect(gestor.status()).toBe(403);

    // Recepción + tipo clínico: 403 (Tarea 09, decisión 7 -- misma función
    // validar_tipo_servicio_por_rol que ya usan los otros dos endpoints de anexar).
    const recepClinico = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.recep.token),
      data: { tipo_servicio: 'VACUNACION', nombre_servicio: testTag('vac'), precio_unitario: 12000 },
    });
    expect(recepClinico.status()).toBe(403);

    // El veterinario sí puede anexar el mismo tipo clínico.
    const vetClinico = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'VACUNACION',
      nombre_servicio: testTag('vac'),
      precio_unitario: 12000,
    }, S.vetToken);
    expect(vetClinico.tipo_servicio).toBe('VACUNACION');
    // Todo alta al carrito queda SOLICITADO, tenga o no área (decisión 3);
    // el atajo sin área se resuelve recién al confirmar.
    expect(vetClinico.estado).toBe('SOLICITADO');
  });

  test('confirmar servicios: gate de sesión/rol (fila 9 de la matriz)', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);

    const anonimo = await request.post(`/api/ordenes/${orden.id}/confirmar`);
    expect(anonimo.status()).toBe(401);

    const recep = await request.post(`/api/ordenes/${orden.id}/confirmar`, {
      headers: authHeaders(S.recep.token),
    });
    expect(recep.status()).toBe(403);

    const gestor = await request.post(`/api/ordenes/${orden.id}/confirmar`, {
      headers: authHeaders(S.gestorToken),
    });
    expect(gestor.status()).toBe(403);

    const admin = await request.post(`/api/ordenes/${orden.id}/confirmar`, {
      headers: authHeaders(S.token),
    });
    expect(admin.status()).toBe(200);
  });

  test('anexar y confirmar sobre una orden CERRADA son 409, no 500', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    const cerrada = await request.post(`/api/ordenes/${orden.id}/cerrar`, {
      headers: authHeaders(S.token),
    });
    expect(cerrada.status()).toBe(200);

    const anexar = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.vetToken),
      data: { tipo_servicio: 'ESTETICA', precio_unitario: 1000 },
    });
    expect(anexar.status()).toBe(409);

    const confirmar = await request.post(`/api/ordenes/${orden.id}/confirmar`, {
      headers: authHeaders(S.token),
    });
    expect(confirmar.status()).toBe(409);
  });

  // ---------------------------------------------------------------------
  // El wiring de la etapa 4: POST /api/servicios/ (servicio directo) ahora
  // exige orden_id (decisión 1: no hay trabajo fuera de una orden).
  // ---------------------------------------------------------------------
  test('servicio directo (POST /api/servicios/): orden_id obligatorio y respeta el candado y la mascota de la orden', async ({ request }) => {
    // Sin orden_id: 422, no 500.
    const sinOrden = await request.post('/api/servicios/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        tipo_servicio: 'ESTETICA',
        nombre_servicio: testTag('sinOrden'),
        precio_unitario: 3000,
      },
    });
    expect(sinOrden.status()).toBe(422);

    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);

    const directo = await request.post('/api/servicios/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        orden_id: orden.id,
        tipo_servicio: 'ESTETICA',
        nombre_servicio: testTag('directo'),
        precio_unitario: 3000,
        estado: 'SOLICITADO',
      },
    });
    expect(directo.status(), await directo.text()).toBe(201);
    expect((await directo.json()).orden_id).toBe(orden.id);

    // La mascota del servicio tiene que ser la de la orden.
    const otroTutor = await createTestPropietario(request);
    const otraMascota = await createTestMascota(request, otroTutor.id);
    const cruzado = await request.post('/api/servicios/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: otraMascota.id,
        orden_id: orden.id,
        tipo_servicio: 'ESTETICA',
        nombre_servicio: testTag('cruzado'),
        precio_unitario: 1000,
      },
    });
    expect(cruzado.status()).toBe(400);
    await deleteTestMascota(request, otraMascota.id);
    await deleteTestPropietario(request, otroTutor.id);

    // Una orden que ya no admite trabajo (CERRADA) rechaza el alta: 409.
    const ordenVacia = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    await request.post(`/api/ordenes/${ordenVacia.id}/cerrar`, { headers: authHeaders(S.token) });
    const tarde = await request.post('/api/servicios/', {
      headers: authHeaders(S.vetToken),
      data: {
        mascota_id: S.mascota.id,
        orden_id: ordenVacia.id,
        tipo_servicio: 'ESTETICA',
        nombre_servicio: testTag('tarde'),
        precio_unitario: 1000,
      },
    });
    expect(tarde.status()).toBe(409);
  });

  // ---------------------------------------------------------------------
  // Facturar por orden (orden-servicio-carrito, decisión 6)
  // ---------------------------------------------------------------------
  test('vista previa de lo pendiente: lista los ítems sin facturar y su total', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA', nombre_servicio: testTag('uno'), precio_unitario: 3000,
    }, S.recep.token);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA', nombre_servicio: testTag('dos'), precio_unitario: 2000,
    }, S.recep.token);
    await confirmarServiciosOrden(request, orden.id, S.token);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(S.token) });

    const preview = await pendientesFacturarOrden(request, orden.id, S.recep.token);
    expect(preview.items.length).toBe(2);
    expect(preview.total).toBe(5000);
  });

  test('facturar una orden cerrada: queda FACTURADA y los servicios facturados', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    const servicio = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA', nombre_servicio: testTag('cobrar'), precio_unitario: 7000,
    }, S.recep.token);
    await confirmarServiciosOrden(request, orden.id, S.token);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(S.token) });

    const res = await facturarOrden(request, orden.id, { metodo_pago: 'Efectivo', total_pagado: 7000 }, S.recep.token);
    expect(res.status(), await res.text()).toBe(201);
    const factura = await res.json();
    expect(factura.propietario_id).toBe(S.propietario.id);
    expect(factura.total).toBe(7000);
    expect(factura.detalles.some((d) => d.servicio_id === servicio.id)).toBe(true);

    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(detalle.estado).toBe('FACTURADA');
    const lineaFacturada = detalle.servicios.find((s) => s.id === servicio.id);
    expect(lineaFacturada.facturado).toBe(true);

    S._facturaOrdenId = factura.id;
    S._ordenFacturadaId = orden.id;
    S._servicioFacturadoId = servicio.id;
  });

  test('facturar una orden no cerrada (ABIERTA o EN_ATENCION) es 409 y no crea factura', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    expect(orden.estado).toBe('ABIERTA');

    const abierta = await facturarOrden(request, orden.id, {}, S.recep.token);
    expect(abierta.status()).toBe(409);

    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA', nombre_servicio: testTag('pend'), precio_unitario: 1000,
    }, S.recep.token);
    await confirmarServiciosOrden(request, orden.id, S.token);
    const enAtencion = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(enAtencion.estado).toBe('EN_ATENCION');

    const res = await facturarOrden(request, orden.id, {}, S.recep.token);
    expect(res.status()).toBe(409);
  });

  test('facturar una orden CERRADA sin ítems pendientes es 409', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(S.token) });

    const res = await facturarOrden(request, orden.id, {}, S.recep.token);
    expect(res.status()).toBe(409);
  });

  test('doble facturación de la misma orden: se crea una sola factura y la segunda es 409', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.recep.token);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA', nombre_servicio: testTag('doble'), precio_unitario: 4000,
    }, S.recep.token);
    await confirmarServiciosOrden(request, orden.id, S.token);
    await request.post(`/api/ordenes/${orden.id}/cerrar`, { headers: authHeaders(S.token) });

    const [primera, segunda] = await Promise.all([
      facturarOrden(request, orden.id, {}, S.recep.token),
      facturarOrden(request, orden.id, {}, S.recep.token),
    ]);
    const estados = [primera.status(), segunda.status()].sort();
    expect(estados).toEqual([201, 409]);
  });

  test('anular la factura de una orden FACTURADA la reabre a CERRADA y sus servicios quedan sin facturar', async ({ request }) => {
    expect(S._facturaOrdenId, 'depende del test de facturar una orden cerrada').toBeTruthy();

    await anularTestFactura(request, S._facturaOrdenId, S.token);

    const detalle = await (await request.get(`/api/ordenes/${S._ordenFacturadaId}`, {
      headers: authHeaders(S.recep.token),
    })).json();
    expect(detalle.estado).toBe('CERRADA');
    const linea = detalle.servicios.find((s) => s.id === S._servicioFacturadoId);
    expect(linea.facturado).toBe(false);

    // Puede volver a facturarse.
    const preview = await pendientesFacturarOrden(request, S._ordenFacturadaId, S.recep.token);
    expect(preview.items.some((it) => it.id_interno === S._servicioFacturadoId)).toBe(true);
  });
});
