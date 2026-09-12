// Unidad — Servicios desde la consulta (Tarea 09, FASE 2)
//
// docs/tareas/09-servicios-desde-la-consulta.md · docs/diseno/flujo-consulta-servicios.md
//
// La consulta pasa a ser el centro: todo servicio se anexa a partir de ella y
// el "servicio directo" (corte de uñas, venta de mostrador) es la excepción,
// un ServicioConsulta con consulta_id = NULL colgado de la mascota.
//
// Contrato bajo prueba (verificado contra el backend commiteado en
// redesign/minimalist-ui):
//   - ServicioConsulta.consulta_id es nullable; mascota_id se llena siempre.
//     CHECK ck_servicio_consulta_scope: al menos uno de los dos.
//   - Consulta.estado (ciclo de vida clínico, separado de estado_pago):
//     ABIERTA por default al crear · CERRADA al facturar · ANULADA para error.
//   - POST /api/servicios/           → servicio directo (exige mascota_id, sin consulta_id)
//   - GET  /api/servicios/?mascota_id=<id>
//   - PATCH/DELETE /api/servicios/{id}  (+ alias PATCH/DELETE /api/consultas/servicios/{id})
//   - GET  /api/consultas/?estado=ABIERTA
//   - POST /api/facturas/from-consulta/{id} → arma detalles desde consulta.servicios
//     + honorario, emite la factura y deja la consulta CERRADA. Sin doble conteo.
//   - Permisos (require_roles / validar_tipo_servicio_por_rol): sin token se
//     deja pasar (los e2e sin auth siguen verdes); con token de rol
//     `recepcionista`, los tipos clínicos (VACUNACION, DESPARASITACION, CIRUGIA,
//     HOSPITALIZACION, LABORATORIO) dan 403 al anexar / crear servicio directo.
//
// Criterio UI vs API: igual que flujo-clinico.spec.js / clinico.spec.js, la
// regla de negocio se ejerce por API. El modal de consulta y la pantalla
// sec-consulta-abierta son del rol médico y de widgets custom; forzarlos por UI
// probaría el widget, no la regla.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  authHeaders,
  testTag,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  deleteTestUser,
  createTestConsulta,
  deleteTestConsulta,
  createTestRecepcionista,
  createTestServicioDirecto,
  deleteTestServicio,
  anexarServicioConsulta,
  facturarDesdeConsulta,
  createTestFactura,
  anularTestFactura,
} = require('./helpers');

// Serial: comparten propietario/mascota/veterinario sembrados una sola vez, y
// varios pasos dejan estado (consultas CERRADAS) que el último test inspecciona.
test.describe.serial('Servicios desde la consulta (Tarea 09, FASE 2)', () => {
  const S = {
    token: null,
    vet: null,
    propietario: null,
    mascota: null,
    recep: null,          // { user, token }
    runStartedAt: null,   // corte "antes de este run" para el test de datos históricos
    consultaIds: [],      // para limpieza best-effort
    facturaIds: [],
    servicioDirectoIds: [],
  };

  test.beforeAll(async ({ request }) => {
    S.runStartedAt = new Date();
    S.token = await getAdminToken(request);
    S.vet = await createTestVeterinario(request, S.token);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
  });

  test.afterAll(async ({ request }) => {
    // Orden inverso a las dependencias. Ninguna de estas lanza.
    for (const id of S.facturaIds) await anularTestFactura(request, id);
    for (const id of S.servicioDirectoIds) await deleteTestServicio(request, id);
    for (const id of S.consultaIds) await deleteTestConsulta(request, id);
    if (S.recep?.user?.id) await deleteTestUser(request, S.token, S.recep.user.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
  });

  test('abrir una consulta y anexarle 3 servicios de tipos distintos: los 3 quedan asociados', async ({ request }) => {
    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    });
    S.consultaIds.push(consulta.id);

    // Una consulta nueva nace ABIERTA (decisión 6).
    expect(consulta.estado).toBe('ABIERTA');

    // 3 tipos distintos, todos NO clínicos y en "Pendiente" para no tocar stock:
    // acá se prueba la asociación consulta↔servicio, no el kardex.
    const tipos = ['ESTETICA', 'PROCEDIMIENTO', 'INSUMO'];
    const anexados = [];
    for (const tipo of tipos) {
      const s = await anexarServicioConsulta(request, consulta.id, {
        tipo_servicio: tipo,
        nombre_servicio: testTag(`serv_${tipo}`),
        precio_unitario: 5000,
      });
      expect(s.id, `anexar ${tipo} devuelve el servicio creado`).toBeTruthy();
      expect(s.consulta_id).toBe(consulta.id);
      // mascota_id se llena siempre, también con consulta (decisión 1).
      expect(s.mascota_id).toBe(S.mascota.id);
      anexados.push(s);
    }

    // GET /api/consultas/{id} → servicios tiene exactamente los 3.
    const full = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    const vivos = (full.servicios || []).filter((s) => !s.is_deleted);
    expect(vivos.length).toBe(3);
    expect(new Set(vivos.map((s) => s.tipo_servicio))).toEqual(new Set(tipos));
    for (const s of vivos) {
      expect(s.consulta_id).toBe(consulta.id);
    }
  });

  test('servicio directo sin consulta: aparece en el historial de la mascota y se puede facturar', async ({ request }) => {
    const directo = await createTestServicioDirecto(request, S.mascota.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('corteUnas'),
      precio_unitario: 6000,
    });
    S.servicioDirectoIds.push(directo.id);

    // Nace sin consulta, colgado de la mascota (decisión 1).
    expect(directo.consulta_id).toBeNull();
    expect(directo.mascota_id).toBe(S.mascota.id);

    // Visible en el historial de servicios directos de la mascota.
    const lista = await (await request.get(`/api/servicios/?mascota_id=${S.mascota.id}`)).json();
    expect(Array.isArray(lista)).toBe(true);
    const enLista = lista.find((s) => s.id === directo.id);
    expect(enLista, 'el servicio directo aparece en GET /api/servicios/?mascota_id=').toBeTruthy();
    expect(enLista.consulta_id).toBeNull();

    // Se puede facturar SIN consulta: POST /api/facturas/ con detalles[].servicio_id
    // y sin consulta_id.
    const factura = await createTestFactura(request, {
      propietarioId: S.propietario.id,
      consultaId: null,
      detalles: [
        {
          descripcion: directo.nombre_servicio,
          cantidad: 1,
          precio_unitario: directo.precio_unitario,
          servicio_id: directo.id,
        },
      ],
    });
    S.facturaIds.push(factura.id);

    // La factura queda sin consulta y su línea apunta al servicio directo.
    expect(factura.consulta_id).toBeNull();
    expect(factura.total).toBe(6000);
    const linea = factura.detalles.find((d) => d.servicio_id === directo.id);
    expect(linea, 'la factura tiene una línea ligada al servicio directo').toBeTruthy();

    // Nota: ServicioConsultaResponse no expone el booleano `facturado` (no está
    // en el schema, ni antes de Tarea 09), así que "servicio facturado=true" se
    // verifica por su efecto observable: la línea de factura queda ligada al
    // servicio_id (arriba) y el servicio sigue vivo en el historial (no se borra
    // al facturar).
    const listaPost = await (await request.get(`/api/servicios/?mascota_id=${S.mascota.id}`)).json();
    expect(listaPost.some((s) => s.id === directo.id)).toBe(true);
  });

  test('facturar una consulta con servicios anexados: todas las líneas, total correcto, sin duplicar', async ({ request }) => {
    const HONORARIO = 25000; // createTestConsulta lo fija en precio_consulta
    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
      precio_consulta: HONORARIO,
    });
    S.consultaIds.push(consulta.id);

    const precios = { ESTETICA: 6000, PROCEDIMIENTO: 10000, INSUMO: 4000 };
    const anexados = [];
    for (const [tipo, precio] of Object.entries(precios)) {
      anexados.push(await anexarServicioConsulta(request, consulta.id, {
        tipo_servicio: tipo,
        nombre_servicio: testTag(`serv_${tipo}`),
        precio_unitario: precio,
      }));
    }
    const totalEsperado = HONORARIO + Object.values(precios).reduce((a, b) => a + b, 0);

    // POST /api/facturas/from-consulta/{id} — un solo paso.
    const factura = await facturarDesdeConsulta(request, consulta.id);
    S.facturaIds.push(factura.id);

    // Todas las líneas: 3 servicios + 1 honorario.
    expect(factura.detalles.length).toBe(4);
    expect(factura.total).toBe(totalEsperado);

    // El honorario es la única línea sin servicio_id, por su monto exacto.
    const lineasHonorario = factura.detalles.filter((d) => !d.servicio_id);
    expect(lineasHonorario.length).toBe(1);
    expect(lineasHonorario[0].precio_unitario).toBe(HONORARIO);

    // NO duplica líneas: cada servicio anexado aparece exactamente una vez.
    const servicioIds = factura.detalles.map((d) => d.servicio_id).filter(Boolean);
    expect(servicioIds.length).toBe(3);
    expect(new Set(servicioIds).size).toBe(3);
    expect(new Set(servicioIds)).toEqual(new Set(anexados.map((s) => s.id)));

    // La consulta queda CERRADA + COBRADO.
    const cerrada = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(cerrada.estado).toBe('CERRADA');
    expect(cerrada.estado_pago).toBe('COBRADO');

    // Volver a facturarla no genera una segunda factura ni re-cuenta líneas:
    // ya no quedan ítems pendientes → 400.
    const reintento = await request.post(`/api/facturas/from-consulta/${consulta.id}`, { data: {} });
    expect(reintento.status()).toBe(400);
  });

  test('una consulta a medias (ABIERTA) se retoma, se le anexa otro servicio, se factura y pasa a CERRADA', async ({ request }) => {
    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    });
    S.consultaIds.push(consulta.id);

    // Anexar algo y "dejarla a medias".
    await anexarServicioConsulta(request, consulta.id, { tipo_servicio: 'ESTETICA', precio_unitario: 3000 });

    // Aparece en la bandeja de consultas abiertas (pantalla "Hoy").
    const abiertas = await (await request.get('/api/consultas/?estado=ABIERTA&limit=200', { headers: authHeaders(S.token) })).json();
    expect(abiertas.some((c) => c.id === consulta.id)).toBe(true);
    expect(abiertas.every((c) => c.estado === 'ABIERTA')).toBe(true);

    // Retomarla: anexar otro servicio y facturar.
    await anexarServicioConsulta(request, consulta.id, { tipo_servicio: 'PROCEDIMIENTO', precio_unitario: 7000 });
    const factura = await facturarDesdeConsulta(request, consulta.id);
    S.facturaIds.push(factura.id);
    expect(factura.detalles.length).toBe(3); // 2 servicios + honorario

    // Ya no está abierta.
    const cerrada = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(cerrada.estado).toBe('CERRADA');
    const abiertasPost = await (await request.get('/api/consultas/?estado=ABIERTA&limit=200', { headers: authHeaders(S.token) })).json();
    expect(abiertasPost.some((c) => c.id === consulta.id)).toBe(false);
  });

  test('una recepcionista no puede anexar servicios clínicos, ni llamando a la API directamente', async ({ request }) => {
    S.recep = await createTestRecepcionista(request, S.token);

    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    });
    S.consultaIds.push(consulta.id);

    // Anexar una CIRUGÍA a la consulta → 403.
    const cirugia = await request.post(`/api/consultas/${consulta.id}/servicios`, {
      headers: authHeaders(S.recep.token),
      data: { tipo_servicio: 'CIRUGIA', nombre_servicio: testTag('cir'), cantidad: 1, precio_unitario: 50000, estado: 'Pendiente' },
    });
    expect(cirugia.status(), await cirugia.text()).toBe(403);

    // Crear un servicio directo de tipo VACUNACION → 403.
    const vacuna = await request.post('/api/servicios/', {
      headers: authHeaders(S.recep.token),
      data: { mascota_id: S.mascota.id, tipo_servicio: 'VACUNACION', nombre_servicio: testTag('vac'), cantidad: 1, precio_unitario: 12000, estado: 'Pendiente' },
    });
    expect(vacuna.status(), await vacuna.text()).toBe(403);

    // Tampoco por la puerta de atrás de /api/clinico (require_roles corta antes
    // de tocar la DB, por eso los ids pueden ser dummy).
    const clinVac = await request.post('/api/clinico/vacunacion', {
      headers: authHeaders(S.recep.token),
      data: { consulta_id: consulta.id, vacuna_id: 1, lote: 'x' },
    });
    expect(clinVac.status(), await clinVac.text()).toBe(403);
    const clinDesp = await request.post('/api/clinico/desparasitacion', {
      headers: authHeaders(S.recep.token),
      data: { consulta_id: consulta.id, producto_id: 1, tipo: 'Interna', dosis: '1' },
    });
    expect(clinDesp.status(), await clinDesp.text()).toBe(403);

    // Pero SÍ puede anexar un servicio NO clínico (ESTÉTICA) → 201.
    const estetica = await request.post(`/api/consultas/${consulta.id}/servicios`, {
      headers: authHeaders(S.recep.token),
      data: { tipo_servicio: 'ESTETICA', nombre_servicio: testTag('est'), cantidad: 1, precio_unitario: 6000, estado: 'Pendiente' },
    });
    expect(estetica.status(), await estetica.text()).toBe(201);
    expect((await estetica.json()).tipo_servicio).toBe('ESTETICA');
  });

  test('DELETE /api/consultas/{id} exige admin (revisión final Tarea 09)', async ({ request }) => {
    // Antes de la revisión, este endpoint no exigía sesión y hacía hard-delete
    // en cascada (servicios, recetas, vacunaciones...) sin dejar rastro.
    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    });

    const sinToken = await request.delete(`/api/consultas/${consulta.id}`);
    expect(sinToken.status()).toBe(401);

    const conRecepcion = await request.delete(`/api/consultas/${consulta.id}`, {
      headers: authHeaders(S.recep.token),
    });
    expect(conRecepcion.status()).toBe(403);

    // Sigue intacta tras los dos intentos.
    const intacta = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(intacta.id).toBe(consulta.id);

    const conAdmin = await request.delete(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) });
    expect(conAdmin.status()).toBe(204);
  });

  test('anular la factura de una consulta la reabre y se puede volver a facturar', async ({ request }) => {
    const consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
    });
    S.consultaIds.push(consulta.id);
    await anexarServicioConsulta(request, consulta.id, { tipo_servicio: 'PROCEDIMIENTO', precio_unitario: 8000 });

    const factura = await facturarDesdeConsulta(request, consulta.id);
    const cerrada = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(cerrada.estado).toBe('CERRADA');
    expect(cerrada.estado_pago).toBe('COBRADO');
    expect(cerrada.servicios.every((s) => s.facturado)).toBe(true);

    // Anular: la consulta vuelve a ABIERTA / POR_COBRAR y sus líneas a no facturadas.
    const anular = await request.post(`/api/facturas/${factura.id}/anular`, { headers: authHeaders(S.token) });
    expect(anular.status(), await anular.text()).toBe(200);
    const reabierta = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(reabierta.estado).toBe('ABIERTA');
    expect(reabierta.estado_pago).toBe('POR_COBRAR');
    expect(reabierta.servicios.every((s) => !s.facturado)).toBe(true);

    // Y se puede volver a facturar (antes quedaba trabada sin ítems pendientes).
    const factura2 = await facturarDesdeConsulta(request, consulta.id);
    S.facturaIds.push(factura2.id);
    expect(factura2.total).toBe(factura.total);
  });

  test('la bandeja "Hoy" se puede filtrar por veterinario: cada uno ve solo lo suyo', async ({ request }) => {
    const otroVet = await createTestVeterinario(request, S.token);

    const miConsulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: S.vet.id });
    const suConsulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: otroVet.id });
    S.consultaIds.push(miConsulta.id, suConsulta.id);

    const mias = await (await request.get(
      `/api/consultas/?estado=ABIERTA&limit=500&veterinario_id=${S.vet.id}`,
      { headers: authHeaders(S.token) },
    )).json();
    expect(mias.every((c) => c.veterinario_id === S.vet.id)).toBe(true);
    expect(mias.some((c) => c.id === miConsulta.id)).toBe(true);
    expect(mias.some((c) => c.id === suConsulta.id)).toBe(false);

    // Sin el filtro (lo que ven admin y recepción) están las dos.
    const todas = await (await request.get('/api/consultas/?estado=ABIERTA&limit=500', { headers: authHeaders(S.token) })).json();
    expect(todas.some((c) => c.id === miConsulta.id)).toBe(true);
    expect(todas.some((c) => c.id === suConsulta.id)).toBe(true);

    await deleteTestUser(request, S.token, otroVet.id);
  });

  test('las consultas y servicios cargados antes de la migración siguen visibles', async ({ request }) => {
    // Ask literal de la tarea: GET /api/consultas/?limit=5 responde 200 con lista.
    const cinco = await request.get('/api/consultas/?limit=5', { headers: authHeaders(S.token) });
    expect(cinco.status()).toBe(200);
    const listaCinco = await cinco.json();
    expect(Array.isArray(listaCinco)).toBe(true);
    expect(listaCinco.length).toBeGreaterThan(0);

    // El filtro nuevo por estado del ciclo de vida responde y sólo trae CERRADAS,
    // cada una con su array de servicios.
    const cerradasRes = await request.get('/api/consultas/?estado=CERRADA&limit=5', { headers: authHeaders(S.token) });
    expect(cerradasRes.status()).toBe(200);
    const cerradas = await cerradasRes.json();
    expect(cerradas.length).toBeGreaterThan(0);
    for (const c of cerradas) {
      expect(c.estado).toBe('CERRADA');
      expect(Array.isArray(c.servicios)).toBe(true);
    }

    // Y hay al menos una consulta CERRADA anterior a este run (dato migrado, no
    // creado por la suite): la migración d0e1f2a3b4c5 dejó las históricas en
    // CERRADA. Se toma una y se abre por id para confirmar que sigue accesible.
    const amplio = await (await request.get('/api/consultas/?limit=200', { headers: authHeaders(S.token) })).json();
    const historicas = amplio.filter(
      (c) => c.estado === 'CERRADA' && new Date(c.fecha_consulta) < S.runStartedAt
    );
    expect(historicas.length, 'hay consultas CERRADA previas a la migración').toBeGreaterThan(0);

    const una = historicas[0];
    const detalleRes = await request.get(`/api/consultas/${una.id}`, { headers: authHeaders(S.token) });
    expect(detalleRes.status()).toBe(200);
    const detalle = await detalleRes.json();
    expect(detalle.id).toBe(una.id);
    expect(detalle.estado).toBe('CERRADA');
    expect(Array.isArray(detalle.servicios)).toBe(true);
  });
});
