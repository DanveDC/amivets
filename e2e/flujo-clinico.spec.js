// Unidad C — Flujo clínico de negocio, punta a punta contra el Postgres local
//
// Cubre la cadena central del negocio:
//   Propietario -> Mascota -> Cita (agenda interna) -> Consulta -> Factura
//
// Criterio de mockeo: en este repo SOLO se mockea la red para los flujos de
// Supabase / QR (ver admin-panel.spec.js), que no están configurados en este
// docker-compose. Todo lo de esta unidad va contra el backend real.
//
// Criterio UI vs API: se maneja por UI lo que es estable (alta y edición de
// propietario, que son formularios nativos en un modal). Cita, Consulta y
// Factura viven detrás de la selección de paciente en Consultorio, de widgets
// custom (createPrettySelect) y de ramas por rol (un admin ni siquiera abre el
// modal de Consulta: se lo redirige a "orden de turno"). Forzar esos caminos
// por UI sería frágil y probaría el widget, no la regla de negocio, así que
// esos pasos se ejercen por API y se comentan puntualmente. Toda mutación,
// venga de UI o de API, se contrasta después con un GET a la API, igual que
// hace el test "editar usuario" existente.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  deleteTestProduct,
  deleteTestUser,
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
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

// Serial: cada test consume el estado del anterior (es una cadena de negocio).
// Con workers:1 y fullyParallel:false esto es determinista; el `.serial` solo
// hace explícito que un fallo temprano aborta el resto en vez de encadenar
// errores sin sentido.
test.describe.serial('Flujo clínico — Propietario → Mascota → Cita → Consulta → Factura', () => {
  // Estado compartido entre pasos de la cadena.
  const S = {
    token: null,
    vet: null,
    producto: null,
    propietarioA: null, // dueño original
    propietarioB: null, // dueño tras la transferencia
    mascota: null,
    cita: null,
    consulta: null,
    servicioId: null,
    factura: null,
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    // Veterinario real: consultas y citas exigen un usuarios.id con role
    // exactamente "veterinario".
    S.vet = await createTestVeterinario(request, S.token);
    // Producto real: detalles_receta.medicamento_id es FK NOT NULL a inventario.
    S.producto = await createTestProduct(request);
  });

  test.afterAll(async ({ request }) => {
    // Limpieza best-effort en orden inverso a las dependencias. Ninguna lanza.
    if (S.factura?.id) await anularTestFactura(request, S.factura.id);
    if (S.consulta?.id) await deleteTestConsulta(request, S.consulta.id);
    if (S.cita?.id) await cancelTestCita(request, S.cita.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietarioA?.id) await deleteTestPropietario(request, S.propietarioA.id);
    if (S.propietarioB?.id) await deleteTestPropietario(request, S.propietarioB.id);
    if (S.producto?.id) await deleteTestProduct(request, S.producto.id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
  });

  test('propietario: alta y edición por UI, contrastadas contra la API', async ({ page, request }) => {
    const nombre = testTag('propUI');
    const cedula = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-propietarios"]');

    // --- Alta por el modal ---
    await page.click('#btnRegistrarPropietarioAlt');
    await expect(page.locator('#modalPropietario')).toBeVisible();
    await page.fill('#propietarioNombre', nombre);
    await page.fill('#propietarioApellido', 'Tester');
    await page.fill('#propietarioCedula', cedula);
    await page.fill('#propietarioTelefono', '099111222');
    await page.fill('#propietarioEmail', `${nombre}@example.com`);
    await page.fill('#propietarioDireccion', 'Av. Siempreviva 742');
    await page.click('#formPropietario button[type="submit"]');
    await expect(page.locator('#modalPropietario')).toBeHidden();

    // Contraste API: el alta debe existir y estar activa.
    const listRes = await request.get('/api/propietarios/?activo=true', { headers: authHeaders(S.token) });
    const propietarios = await listRes.json();
    const creado = propietarios.find((p) => p.cedula === cedula);
    expect(creado, 'el propietario creado por UI debe aparecer en la API').toBeTruthy();
    expect(creado.nombre).toBe(nombre);
    S.propietarioA = creado;

    // handlePropietarioSubmit NO refresca el listado; escribir en el buscador
    // dispara loadPropietarios(filter) y de paso deja una sola fila visible.
    await page.fill('#searchPropietario', cedula);
    await expect(page.locator('#propietariosTableBody')).toContainText(nombre);

    // --- Edición por el modal ---
    await page.click('#propietariosTableBody tr button[title="Editar"]');
    await expect(page.locator('#modalEditarPropietario')).toBeVisible();
    const nuevoTel = '098765432';
    const nuevoEmail = `edit_${nombre}@example.com`;
    await page.fill('#editPropietarioTelefono', nuevoTel);
    await page.fill('#editPropietarioEmail', nuevoEmail);
    await page.click('#formEditarPropietario button[type="submit"]');
    await expect(page.locator('#modalEditarPropietario')).toBeHidden();

    await page.fill('#searchPropietario', cedula);
    await expect(page.locator('#propietariosTableBody')).toContainText(nuevoTel);

    // Contraste API: la edición se persistió.
    const getRes = await request.get(`/api/propietarios/${S.propietarioA.id}`, { headers: authHeaders(S.token) });
    const actualizado = await getRes.json();
    expect(actualizado.telefono).toBe(nuevoTel);
    expect(actualizado.email).toBe(nuevoEmail);
    S.propietarioA = actualizado;
  });

  test('mascota: alta ligada al propietario, edición, transferencia y endpoint de peso', async ({ page, request }) => {
    // El alta de mascota se hace por API: el campo "propietario" del modal es
    // un combobox custom (createPrettySelect), no un <select> nativo; guiarlo
    // por teclado en Playwright es frágil y ajeno a la regla de negocio.
    S.mascota = await createTestMascota(request, S.propietarioA.id, { peso: 11.2 });
    expect(S.mascota.propietario_id).toBe(S.propietarioA.id);
    expect(S.mascota.codigo_historia, 'crear_mascota genera codigo_historia').toBeTruthy();

    // Verificación por UI: el paciente aparece en el listado de Consultorio.
    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-consultorio"]');
    // El nombre en la respuesta viene con el apellido del dueño pegado
    // (MascotaResponse.append_apellido); el prefijo PWTEST_ del alta es estable.
    const nombreBase = S.mascota.nombre.split(' ')[0];
    await expect(page.locator('#consultorioMascotasList')).toContainText(nombreBase);

    // --- Edición por API + contraste ---
    const putRes = await request.put(`/api/mascotas/${S.mascota.id}`, {
      headers: authHeaders(S.token),
      data: { color: 'Negro', peso: 12.0, observaciones: testTag('obs') },
    });
    expect(putRes.ok()).toBeTruthy();
    const editada = await putRes.json();
    expect(editada.color).toBe('Negro');
    expect(editada.peso).toBe(12.0);

    // --- Transferencia a un nuevo propietario ---
    S.propietarioB = await createTestPropietario(request);
    const motivo = testTag('transfer');
    const transRes = await request.post(`/api/mascotas/${S.mascota.id}/transferir`, {
      headers: authHeaders(S.token),
      data: { nuevo_propietario_id: S.propietarioB.id, motivo },
    });
    expect(transRes.ok(), await transRes.text()).toBeTruthy();

    const afterTransfer = await (await request.get(`/api/mascotas/${S.mascota.id}`, { headers: authHeaders(S.token) })).json();
    expect(afterTransfer.propietario_id, 'la mascota quedó bajo el nuevo dueño').toBe(S.propietarioB.id);
    S.mascota = afterTransfer;

    // --- Endpoint de historial de peso ---
    // Sin consultas todavía: el historial se arma SOLO desde consultas con
    // peso (MascotaService.obtener_historial_peso), no desde Mascota.peso.
    const pesoRes = await request.get(`/api/mascotas/${S.mascota.id}/peso-history`, { headers: authHeaders(S.token) });
    expect(pesoRes.ok()).toBeTruthy();
    const historial = await pesoRes.json();
    expect(Array.isArray(historial)).toBe(true);
    expect(historial.length).toBe(0);
  });

  test('cita (agenda interna /api/citas): agendar, check-in, editar y cancelar', async ({ request }) => {
    // Por API: el alta de cita en la agenda interna solo se alcanza desde la
    // UI como "orden de turno" de un admin, tras seleccionar paciente en
    // Consultorio y a través de widgets custom. La regla de negocio (choque de
    // agenda del veterinario, timestamps de check-in) vive en /api/citas.
    S.cita = await createTestCita(request, {
      veterinarioId: S.vet.id,
      propietarioId: S.mascota.propietario_id,
      mascotaId: S.mascota.id,
      tipo: 'PWTEST Consulta',
    });
    expect(S.cita.estado).toBe('PENDIENTE');

    // Check-in: PUT /{id}/checkin sella hora_llegada al pasar a EN_ESPERA.
    const checkinRes = await request.put(`/api/citas/${S.cita.id}/checkin`, {
      headers: authHeaders(S.token),
      data: { estado: 'EN_ESPERA' },
    });
    expect(checkinRes.ok(), await checkinRes.text()).toBeTruthy();
    let cita = await checkinRes.json();
    expect(cita.estado).toBe('EN_ESPERA');
    expect(cita.hora_llegada, 'check-in registra la hora de llegada').toBeTruthy();

    // Edición general.
    const nuevaObs = testTag('citaObs');
    const putRes = await request.put(`/api/citas/${S.cita.id}`, {
      headers: authHeaders(S.token),
      data: { observaciones: nuevaObs, tipo: 'PWTEST Control' },
    });
    expect(putRes.ok()).toBeTruthy();
    cita = await putRes.json();
    expect(cita.observaciones).toBe(nuevaObs);
    expect(cita.tipo).toBe('PWTEST Control');

    // Cancelar: DELETE es un borrado lógico (estado -> CANCELADA).
    const delRes = await request.delete(`/api/citas/${S.cita.id}`, { headers: authHeaders(S.token) });
    expect(delRes.status()).toBe(204);
    const afterDelete = await (await request.get(`/api/citas/${S.cita.id}`, { headers: authHeaders(S.token) })).json();
    expect(afterDelete.estado).toBe('CANCELADA');
  });

  test('consulta (/api/consultas): registrar, agregar servicio y receta, cambiar estado del servicio', async ({ request }) => {
    // Por API: el modal de Consulta es exclusivo del rol médico; a un admin se
    // lo redirige a "orden de turno" (abrirFormularioConsulta), así que la UI
    // no permite recorrer este paso con las credenciales de la suite.
    S.consulta = await createTestConsulta(request, {
      mascotaId: S.mascota.id,
      veterinarioId: S.vet.id,
      peso: 12.5,
    });
    expect(S.consulta.mascota_id).toBe(S.mascota.id);
    expect(S.consulta.estado_pago).toBe('POR_COBRAR');

    // El historial de peso ahora sí refleja la consulta.
    const historial = await (await request.get(`/api/mascotas/${S.mascota.id}/peso-history`, { headers: authHeaders(S.token) })).json();
    expect(historial.length).toBeGreaterThanOrEqual(1);
    expect(historial[historial.length - 1].peso).toBe(12.5);

    // --- Agregar un servicio a la consulta ---
    // tipo_servicio deliberadamente NO INSUMO/VACUNACION para no tocar stock:
    // acá probamos el ciclo de estados del servicio, no el kardex.
    const servPayload = {
      consulta_id: S.consulta.id, // el schema lo exige aunque el router lo tome del path
      tipo_servicio: 'PROCEDIMIENTO',
      nombre_servicio: testTag('servicio'),
      cantidad: 1,
      precio_unitario: 15000,
      estado: 'Pendiente',
    };
    const servRes = await request.post(`/api/consultas/${S.consulta.id}/servicios`, {
      headers: authHeaders(S.token),
      data: servPayload,
    });
    expect(servRes.status(), await servRes.text()).toBe(201);
    const servicio = await servRes.json();
    S.servicioId = servicio.id;
    expect(servicio.estado).toBe('Pendiente');

    // --- Agregar una receta ---
    const recetaRes = await request.post(`/api/consultas/${S.consulta.id}/recetas`, {
      headers: authHeaders(S.token),
      data: {
        consulta_id: S.consulta.id,
        indicaciones_generales: testTag('indicaciones'),
        detalles: [
          {
            medicamento_id: S.producto.id,
            dosis: '1 comprimido',
            frecuencia: 'cada 12 horas',
            duracion: '7 dias',
          },
        ],
      },
    });
    expect(recetaRes.status(), await recetaRes.text()).toBe(201);
    const recetas = await (await request.get(`/api/consultas/${S.consulta.id}/recetas`, { headers: authHeaders(S.token) })).json();
    expect(recetas.length).toBe(1);
    expect(recetas[0].detalles[0].medicamento_id).toBe(S.producto.id);

    // --- Cambiar el estado del servicio (PATCH) y verificar ---
    const patchRes = await request.patch(`/api/consultas/servicios/${S.servicioId}`, {
      headers: authHeaders(S.token),
      data: { estado: 'Aplicado' },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    expect((await patchRes.json()).estado).toBe('Aplicado');

    const consultaFull = await (await request.get(`/api/consultas/${S.consulta.id}`, { headers: authHeaders(S.token) })).json();
    const servicioEnConsulta = consultaFull.servicios.find((s) => s.id === S.servicioId);
    expect(servicioEnConsulta.estado).toBe('Aplicado');
  });

  test('factura (/api/facturas): emitir desde la consulta, abonar y anular', async ({ request }) => {
    // --- Emitir la factura de la consulta ---
    S.factura = await createTestFactura(request, {
      propietarioId: S.mascota.propietario_id,
      consultaId: S.consulta.id,
      detalles: [
        { descripcion: 'PWTEST Consulta veterinaria', cantidad: 1, precio_unitario: 25000, servicio_id: null },
        { descripcion: 'PWTEST Procedimiento', cantidad: 1, precio_unitario: 15000, servicio_id: S.servicioId },
      ],
    });
    expect(S.factura.total).toBe(40000);
    expect(S.factura.estado).toBe('PENDIENTE');
    expect(S.factura.consulta_id).toBe(S.consulta.id);

    // Emitir factura de una consulta la marca COBRADO.
    const consultaCobrada = await (await request.get(`/api/consultas/${S.consulta.id}`, { headers: authHeaders(S.token) })).json();
    expect(consultaCobrada.estado_pago).toBe('COBRADO');

    // Re-facturar la misma consulta sin anular antes debe dar 409.
    const dupRes = await request.post('/api/facturas/', {
      headers: authHeaders(S.token),
      data: {
        propietario_id: S.mascota.propietario_id,
        consulta_id: S.consulta.id,
        detalles: [{ descripcion: 'PWTEST duplicada', cantidad: 1, precio_unitario: 1000 }],
      },
    });
    expect(dupRes.status()).toBe(409);

    // --- Registrar un abono parcial ---
    const abonoRes = await request.post(`/api/facturas/${S.factura.id}/abonar`, {
      headers: authHeaders(S.token),
      data: { monto: 20000, metodo_pago: 'Efectivo', notas: testTag('abono') },
    });
    expect(abonoRes.status(), await abonoRes.text()).toBe(201);
    const abono = await abonoRes.json();
    expect(Number(abono.monto)).toBe(20000);

    const facturaParcial = await (await request.get(`/api/facturas/${S.factura.id}`, { headers: authHeaders(S.token) })).json();
    expect(facturaParcial.estado).toBe('PARCIAL');
    expect(facturaParcial.total_pagado).toBe(20000);
    expect(facturaParcial.saldo_pendiente).toBe(20000);
    const abonos = await (await request.get(`/api/facturas/${S.factura.id}/abonos`, { headers: authHeaders(S.token) })).json();
    expect(abonos.length).toBe(1);

    // --- Anular la factura ---
    const anularRes = await request.post(`/api/facturas/${S.factura.id}/anular`, { headers: authHeaders(S.token) });
    expect(anularRes.ok(), await anularRes.text()).toBeTruthy();
    expect((await anularRes.json()).estado).toBe('ANULADA');

    const facturaAnulada = await (await request.get(`/api/facturas/${S.factura.id}`, { headers: authHeaders(S.token) })).json();
    expect(facturaAnulada.estado).toBe('ANULADA');

    // Anular de nuevo debe fallar con 400 (ya está anulada).
    const reAnularRes = await request.post(`/api/facturas/${S.factura.id}/anular`, { headers: authHeaders(S.token) });
    expect(reAnularRes.status()).toBe(400);
  });
});
