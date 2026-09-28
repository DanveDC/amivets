// @ts-check
// ficha-animal-ordenes-servicios: el header/landing de la ficha del animal ya
// no ofrece "Agregar consulta"/"Nueva consulta" -- ofrece "+ Orden de
// servicio", que abre un PANEL INLINE (no un modal) dentro de la ficha. El
// tab antes llamado "Consultas" pasa a mostrar las órdenes del animal.
//
// Los flujos de consulta que ya existían (Panel del día, Citas pendientes)
// NO se tocan; hay un chequeo de regresión acá mismo para Panel del día, y el
// resto de la cobertura de esos flujos vive en sus specs originales.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  createTestPropietario,
  createTestMascota,
  createTestVeterinario,
  createTestOrden,
  cerrarTestOrden,
  anexarServicioOrden,
  facturarOrden,
  createTestNota,
  createTestConsulta,
  createTestCita,
  gotoSection,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

// initConsultorio() pinta un listado inicial sin filtrar (50 mascotas) de
// forma async al entrar a la sección; si se busca ANTES de que esa respuesta
// llegue, puede pisar el resultado ya filtrado (no hay generación/guard ahí
// -- hallazgo de revisión, preexistente, fuera de alcance de este cambio).
// Se espera el listado inicial primero para no pisarnos con esa carrera.
//
// `mascota.nombre` tal como lo devuelve la API ya viene con el apellido del
// propietario concatenado para mostrar (ej. "PWTEST_pet_123 Apellido"), pero
// la columna cruda `mascotas.nombre` en la base NO tiene ese sufijo -- y
// `GET /api/mascotas/?search=` filtra sobre la columna cruda. Buscar por el
// nombre completo (con el apellido pegado) no matchea nunca. Mismo hallazgo
// que ya resuelve `orden-veterinario-y-tutores.spec.js` con
// `mascota.nombre.split(' ')[0]`: se busca solo por la primera palabra.
async function seleccionarMascotaEnLista(page, nombre) {
  const termino = nombre.split(' ')[0];
  await page.waitForSelector('.pet-list-item', { timeout: 15000 });
  await page.fill('#consultorioSearchMascota', termino);
  await page.waitForResponse(
    (r) => r.url().includes('/api/mascotas/') && r.url().includes('search='),
    { timeout: 10000 }
  ).catch(() => {});
  await page.locator('.pet-list-item', { hasText: termino }).first().click({ timeout: 15000 });
}

test.describe('Ficha del animal — header y panel "Nueva orden de servicio"', () => {
  test('no hay botón de "Agregar consulta"/"Nueva consulta" en el header ni en el tab de órdenes', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);

    // Ojo con el scope: #btnNuevoConsulta ("Agregar consulta") vive en el
    // menú global "+ Nuevo" del header, fuera de sec-consultorio -- ESE no se
    // toca (Panel del día lo sigue usando). El chequeo acá es sobre la ficha.
    const ficha = page.locator('#sec-consultorio');
    await expect(page.locator('#btnFichaNuevaOrden')).toBeVisible();
    await expect(page.locator('#btnFichaNuevaOrden')).toHaveText(/Orden de servicio/);
    await expect(ficha.locator('button:has-text("Agregar consulta")')).toHaveCount(0);
    await expect(ficha.locator('button:has-text("Nueva consulta")')).toHaveCount(0);
    await expect(ficha.locator('button:has-text("Nueva Consulta")')).toHaveCount(0);

    // Tab "Órdenes de servicio" (antes "Consultas"): mismo botón, sin "+ Nueva Consulta".
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();
    await expect(page.locator('#btnOrdenesNuevaOrden')).toHaveText(/Orden de servicio/);
    await expect(ficha.locator('button:has-text("Nueva Consulta")')).toHaveCount(0);

    // Regresión (revisión): "Consultas" es un tab propio, distinto de
    // "Órdenes de servicio" -- ambos coexisten en la ficha (ver hallazgo de
    // revisión: la creación pasa por "Órdenes", pero las acciones de
    // reparación legacy de consultas viven en su propio tab).
    await expect(page.locator('.pet-nav-item[data-tab="ordenes"]')).toHaveCount(1);
    await expect(page.locator('.pet-nav-item[data-tab="consultas"]')).toHaveCount(1);
  });

  test('crear una orden desde el panel inline (no modal) navega a la orden abierta', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);

    await page.click('#btnFichaNuevaOrden');
    const panel = page.locator('#fichaNuevaOrdenPanel');
    await expect(panel).toBeVisible();
    // El panel es un elemento del flujo de la ficha, no un modal.
    await expect(panel).not.toHaveClass(/modal/);

    // Sin veterinario no se crea la orden.
    await page.click('#btnFnoCrear');
    await expect(page.locator('.notification-toast', { hasText: /veterinario/i }).first()).toBeVisible();
    const sinOrden = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(sinOrden).toHaveLength(0);

    await page.selectOption('#fnoVeterinario', String(vet.id));
    await page.fill('#fnoMotivo', 'Control post-cirugía');
    // Doble click: el botón se deshabilita mientras crea, así que sale UNA orden.
    await page.dblclick('#btnFnoCrear');

    await expect(page.locator('#sec-orden-abierta')).toBeVisible();
    const ordenes = await (await request.get(`/api/ordenes/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
    expect(ordenes).toHaveLength(1);
    const [orden] = ordenes;
    expect(orden.veterinario_id).toBe(vet.id);
    expect(orden.motivo_visita).toBe('Control post-cirugía');
  });

  test('cambiar de paciente cierra el panel de nueva orden del paciente anterior', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascotaA = await createTestMascota(request, prop.id);
    const mascotaB = await createTestMascota(request, prop.id);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascotaA.nombre);
    await page.click('#btnFichaNuevaOrden');
    await expect(page.locator('#fichaNuevaOrdenPanel')).toBeVisible();

    // Vista 1 (listado) y Vista 2 (ficha) son mutuamente excluyentes
    // (ficha-animal-ordenes-servicios, slice 2): con la ficha de A abierta el
    // listado queda oculto, así que para elegir a B hay que volver a la
    // lista primero -- eso ya cierra el panel por sí solo (mostrarLista()
    // llama a cerrarPanelNuevaOrden()), pero igual se confirma que seguir
    // completando la selección de B lo deja cerrado.
    await page.click('#btnVolverALista');
    await expect(page.locator('.patient-list-sidebar')).toBeVisible();
    await seleccionarMascotaEnLista(page, mascotaB.nombre);
    await expect(page.locator('#fichaNuevaOrdenPanel')).toBeHidden();
  });

  test('el tab "Órdenes de servicio" muestra las órdenes del animal, no sus consultas', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();

    await expect(page.locator('#ordenesTableBody')).toContainText(orden.numero, { timeout: 15000 });
    await expect(page.locator('#ordenesTableBody')).toContainText(vet.username);
  });
});

test.describe('Ficha del animal — navegación Vista 1 (lista) ↔ Vista 2 (ficha), slice 2', () => {
  test('volver a la lista restaura el término de búsqueda y el scroll', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const tag = `PWTESTSCROLL${Date.now()}`;
    // Suficientes mascotas para que #consultorioMascotasList (max-height:
    // 60vh, overflow-y:auto) realmente tenga scroll -- si no hay overflow,
    // "restaurar el scroll" pasaría trivialmente aunque el código no hiciera
    // nada.
    const mascotas = [];
    for (let i = 0; i < 12; i++) {
      mascotas.push(await createTestMascota(request, prop.id, { nombre: `${tag}_${i}` }, admin));
    }

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await page.fill('#consultorioSearchMascota', tag);
    await expect(page.locator('#consultorioMascotasList .pet-list-item')).toHaveCount(12, { timeout: 15000 });

    const lista = page.locator('#consultorioMascotasList');
    await lista.evaluate((el) => { el.scrollTop = 150; });
    const scrollAntes = await lista.evaluate((el) => el.scrollTop);
    expect(scrollAntes).toBeGreaterThan(0);

    // Click real de Playwright (page.click/locator.click) hace scroll-into-view
    // del elemento ANTES de clickear -- como el item "_0" es el primero de la
    // lista, eso movería el scroll de vuelta a 0 antes de que
    // _mostrarVistaFicha() lo capture, invalidando la prueba. Se dispara el
    // click nativo del DOM (sin actionability checks de Playwright) para no
    // tocar el scroll que se acaba de fijar.
    await lista.locator('.pet-list-item', { hasText: `${tag}_0` }).first()
      .evaluate((el) => el.click());
    await expect(page.locator('#petProfileContainer')).toBeVisible();
    // Vista 1/Vista 2 son mutuamente excluyentes: la lista queda oculta
    // mientras se ve la ficha.
    await expect(page.locator('.patient-list-sidebar')).toBeHidden();

    await page.click('#btnVolverALista');
    await expect(page.locator('.patient-list-sidebar')).toBeVisible();
    await expect(page.locator('#petProfileContainer')).toBeHidden();
    // El término de búsqueda no se tocó -- nunca se destruyó el DOM del input.
    await expect(page.locator('#consultorioSearchMascota')).toHaveValue(tag);
    await expect(page.locator('#consultorioMascotasList .pet-list-item')).toHaveCount(12);
    const scrollDespues = await lista.evaluate((el) => el.scrollTop);
    expect(scrollDespues).toBe(scrollAntes);
  });

  test('el header de la ficha muestra los datos del animal y los botones Editar/Transferir/Eliminar/+ Orden para un rol no-admin', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);

    // orden-veterinario-y-tutores: Editar/Transferir/Eliminar/"+ Orden de
    // servicio" no tienen gating de rol en el frontend -- el backend
    // (_ROLES_MASCOTAS) es la autoridad real. Se entra como veterinario (no
    // admin) para confirmar que el header no los oculta.
    await loginUI(page, vet.username, TEST_USER_PASSWORD);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);

    await expect(page.locator('#displayNombreMascota')).toHaveText(mascota.nombre);
    await expect(page.locator('#displayInfoMascota')).toContainText(String(mascota.codigo_historia));
    for (const id of ['#btnEditarMascota', '#btnTransferirMascota', '#btnEliminarMascota', '#btnFichaNuevaOrden']) {
      await expect(page.locator(id)).toBeVisible();
    }
  });

  test('"← Volver a la ficha" desde la orden abierta vuelve al paciente correcto', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();
    await expect(page.locator('#ordenesTableBody')).toContainText(orden.numero, { timeout: 15000 });
    await page.locator('#ordenesTableBody').getByRole('button', { name: 'Ver' }).click();
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();

    const btnVolver = page.locator('#btnOaVolverFicha');
    await expect(btnVolver).toBeVisible();
    await btnVolver.click();

    await expect(page.locator('#sec-consultorio')).toBeVisible();
    await expect(page.locator('#petProfileContainer')).toBeVisible();
    await expect(page.locator('#displayNombreMascota')).toHaveText(mascota.nombre);
  });

  test('a 390px de ancho no hay scroll horizontal y los tabs de la ficha son usables', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);

    await page.setViewportSize({ width: 390, height: 844 });
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await expect(page.locator('#petProfileContainer')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // El riel de tabs colapsa a fila horizontal (overflow-x propio) pero
    // sigue siendo clickeable -- cambiar de tab funciona igual que en desktop.
    await page.locator('.pet-nav-item[data-tab="servicios"]').click();
    await expect(page.locator('.pet-nav-item[data-tab="servicios"]')).toHaveClass(/active/);

    const overflowTrasTab = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflowTrasTab).toBeLessThanOrEqual(1);
  });
});

test.describe('GET /api/ordenes/ — parámetro search (backend)', () => {
  test('search filtra por motivo de visita', async ({ request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const motivoUnico = `PWTEST motivo buscable ${Date.now()}`;
    await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id, motivo_visita: motivoUnico }, admin);

    const res = await request.get(`/api/ordenes/?search=${encodeURIComponent('motivo buscable')}`, { headers: authHeaders(admin) });
    expect(res.ok()).toBeTruthy();
    const ordenes = await res.json();
    expect(ordenes.some((o) => o.motivo_visita === motivoUnico)).toBe(true);
  });
});

test.describe('Regresión — flujos de consulta que no se tocan', () => {
  test('Panel del día: "paciente en espera" sigue abriendo el formulario de consulta', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    // "Sala de espera" en Panel del día = citas con estado PENDIENTE
    // (hoy.js::renderSalaEspera). Clickear la fila llama a
    // seleccionarMascotaBasica() + abrirFormularioConsulta() -- ninguna de
    // las dos se tocó en este cambio.
    await createTestCita(request, { veterinarioId: vet.id, propietarioId: prop.id, mascotaId: mascota.id }, admin);

    // Se entra como ESE veterinario (no admin): GET /api/citas/ filtra por
    // veterinario_id sólo para el rol veterinario (soloMias en hoy.js), así
    // la fila no se pierde detrás de años de citas PENDIENTE acumuladas en
    // esta base de e2e (GET /api/citas/ sin ese filtro trae TODAS, con
    // limit=100 y orden ascendente por fecha -- un problema preexistente de
    // este entorno, no de este cambio).
    await loginUI(page, vet.username, TEST_USER_PASSWORD);
    await gotoSection(page, 'sec-hoy');
    // Se identifica la fila por data-mascota-id, no por nombre: el mapa de
    // mascotas que arma cargarMascotasMap() puede no resolver el nombre en
    // una base con miles de mascotas de e2e acumuladas (fallback "Paciente
    // #<id>") -- preexistente, no depende de este cambio.
    const fila = page.locator(`.pd-waiting-row[data-mascota-id="${mascota.id}"]`);
    await expect(fila).toBeVisible({ timeout: 15000 });
    await fila.click();
    // abrirFormularioConsulta() abre modalCita (admin/recepción) o
    // modalConsulta (veterinario) según el rol -- ambos existen siempre en el
    // DOM, sólo el que corresponde recibe la clase "show" (locator combinado
    // con id da "strict mode violation" porque matchea los dos elementos).
    await expect(page.locator('.modal.show')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================================
// SLICE 3: contenido de los tabs (Resumen, Órdenes por estado, Servicios,
// Notas, Facturación, Peso). Slices 1/2 cubrieron navegación y el panel
// inline "Nueva orden"; acá se cubre lo que pintan los tabs con datos reales.
// ============================================================================

test.describe('Tab Resumen — cards con datos reales (tarea 5.1)', () => {
  test('muestra la última orden (con "Ver"), su total facturado y el peso actual', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    // tipo_servicio='CONSULTA' (atajo sin despacho): entra EJECUTADO directo,
    // así la orden se puede cerrar sin pasar por confirmar/despachar.
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'CONSULTA', nombre_servicio: 'Consulta de control', precio_unitario: 150 }, admin);
    await cerrarTestOrden(request, orden.id, admin);
    const resFactura = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 150 }, admin);
    expect(resFactura.ok()).toBeTruthy();

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);

    // "resumen" es el tab activo por defecto al entrar a la ficha.
    const cards = page.locator('#resumenCards');
    await expect(cards).toContainText(orden.numero, { timeout: 15000 });
    await expect(cards).toContainText('FACTURADA');
    await expect(cards).toContainText('150');

    // "Ver" de la card de última orden navega a la orden real.
    await cards.getByRole('button', { name: 'Ver' }).click();
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();
  });
});

test.describe('Tab Evolución peso (tarea 5.6.1)', () => {
  test('es un tab propio que reusa la gráfica de peso existente', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    // GET /peso-history (MascotaService.obtener_historial_peso) lee de
    // Consulta.peso, NO del campo Mascota.peso -- loadWeightChart sólo pinta
    // el <canvas> si ese endpoint trae al menos un punto; sin ninguno,
    // reemplaza el contenedor por un mensaje de "sin registros" (mismo
    // comportamiento que ya tenía dentro de "Resumen" antes de este cambio,
    // no es nuevo acá). Se registra una consulta con peso para tener un
    // punto real.
    await createTestConsulta(request, { mascotaId: mascota.id, veterinarioId: vet.id, peso: 12.5 }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);

    await page.locator('.pet-nav-item[data-tab="peso"]').click();
    await expect(page.locator('.pet-nav-item[data-tab="peso"]')).toHaveClass(/active/);
    await expect(page.locator('#chartContainer canvas#weightChart')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Tab Órdenes — acciones por estado (tarea 5.2.3)', () => {
  test('"Facturar" en una orden CERRADA reusa el flujo real de facturación de la orden', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'CONSULTA', nombre_servicio: 'Consulta a facturar', precio_unitario: 200 }, admin);
    await cerrarTestOrden(request, orden.id, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();
    await expect(page.locator('#ordenesTableBody')).toContainText(orden.numero, { timeout: 15000 });

    const fila = page.locator('#ordenesTableBody tr', { hasText: orden.numero });
    await expect(fila.getByRole('button', { name: '+ Servicio' })).toHaveCount(0);
    await fila.getByRole('button', { name: 'Facturar' }).click();

    // Navega a la orden y dispara el #btnOaFacturar real (modal existente).
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();
    await expect(page.locator('#modalFacturarOrden')).toBeVisible();
    await page.click('#btnConfirmarFacturarOrden');
    await expect(page.locator('.notification-toast', { hasText: /Factura/i }).first()).toBeVisible({ timeout: 10000 });

    const facturas = await (await request.get(`/api/facturas/mascota/${mascota.id}`, { headers: authHeaders(admin) })).json();
    expect(facturas.some((f) => f.total === 200 || f.total_pagado === 200)).toBe(true);
  });

  test('"+ Servicio" en una orden ABIERTA abre el panel real de anexar servicio', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    // ABIERTA por defecto (createTestOrden no cierra la orden).
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();
    await expect(page.locator('#ordenesTableBody')).toContainText(orden.numero, { timeout: 15000 });

    const fila = page.locator('#ordenesTableBody tr', { hasText: orden.numero });
    await expect(fila.getByRole('button', { name: 'Facturar' })).toHaveCount(0);
    await fila.getByRole('button', { name: '+ Servicio' }).click();

    await expect(page.locator('#sec-orden-abierta')).toBeVisible();
    await expect(page.locator('#oaAnexarPanel')).toBeVisible();
  });

  test('"Factura" en una orden FACTURADA abre el preview de la factura vinculada', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'CONSULTA', nombre_servicio: 'Consulta ya facturada', precio_unitario: 90 }, admin);
    await cerrarTestOrden(request, orden.id, admin);
    const resFactura = await facturarOrden(request, orden.id, { metodo_pago: 'EFECTIVO', total_pagado: 90 }, admin);
    expect(resFactura.ok()).toBeTruthy();
    const factura = await resFactura.json();

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="ordenes"]').click();
    await expect(page.locator('#ordenesTableBody')).toContainText(orden.numero, { timeout: 15000 });

    const fila = page.locator('#ordenesTableBody tr', { hasText: orden.numero });
    await fila.getByRole('button', { name: 'Factura' }).click();

    await expect(page.locator('#modalPreviewFactura')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#previewFacturaNumero')).toContainText(String(factura.numero_factura || factura.id));
  });
});

test.describe('Tab Servicios — búsqueda server-side, link a la orden y totales dinámicos (tarea 5.3)', () => {
  test('el buscador filtra server-side y el total dinámico refleja lo filtrado', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const nombreUnico = `PWTEST vacuna especial ${Date.now()}`;
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'CONSULTA', nombre_servicio: nombreUnico, precio_unitario: 50 }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="servicios"]').click();
    await expect(page.locator('#serviciosFeed')).toContainText(nombreUnico, { timeout: 15000 });
    await expect(page.locator('#serviciosTotales')).toContainText('50');

    await page.fill('#servFiltroTexto', 'nombre que no existe en ningún servicio');
    await page.waitForResponse(
      (r) => r.url().includes('/api/servicios/') && r.url().includes('search='),
      { timeout: 10000 }
    );
    await expect(page.locator('#serviciosFeed')).not.toContainText(nombreUnico);
    await expect(page.locator('#serviciosTotales')).toHaveText('');
  });

  test('el detalle de un servicio ofrece "Ver orden" y navega a la orden que lo contiene', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);
    const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    const nombreServicio = `PWTEST servicio con orden ${Date.now()}`;
    await anexarServicioOrden(request, orden.id, { tipo_servicio: 'CONSULTA', nombre_servicio: nombreServicio, precio_unitario: 40 }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="servicios"]').click();
    await expect(page.locator('#serviciosFeed')).toContainText(nombreServicio, { timeout: 15000 });

    await page.locator('.serv-row', { hasText: nombreServicio }).click();
    await page.getByRole('button', { name: 'Ver orden' }).click();
    await expect(page.locator('#sec-orden-abierta')).toBeVisible();
    await expect(page.locator('#avHeaderTitleText')).toContainText(orden.numero);
  });
});

test.describe('Tab Notas — agregar y "Cargar más" (tarea 5.4)', () => {
  test('una nota nueva aparece primera en la lista y "Cargar más" trae el resto', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const tag = `PWTESTNOTA${Date.now()}`;
    // 21 notas viejas (page size del cliente es 20) para forzar "Cargar más".
    for (let i = 0; i < 21; i++) {
      await createTestNota(request, admin, { mascotaId: mascota.id, texto: `${tag}_vieja_${i}` });
    }

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="notas"]').click();
    // La más reciente de las viejas (índice 20) entra en la primera página.
    await expect(page.locator('#notasList')).toContainText(`${tag}_vieja_20`, { timeout: 15000 });
    // La más antigua (índice 0) queda paginada, todavía no visible.
    await expect(page.locator('#notasList')).not.toContainText(`${tag}_vieja_0`);
    await expect(page.locator('#btnNotasCargarMas')).toBeVisible();
    await page.click('#btnNotasCargarMas');
    await expect(page.locator('#notasList')).toContainText(`${tag}_vieja_0`);

    // Nueva nota desde la ficha: aparece primera en la lista.
    await page.getByRole('button', { name: '+ Nueva Nota' }).click();
    await page.fill('#notaTextoInput', `${tag}_nueva`);
    await page.locator('#formNota button[type="submit"]').click();
    await expect(page.locator('#notasList .card-item').first()).toContainText(`${tag}_nueva`, { timeout: 10000 });
  });
});

test.describe('Tab Facturación — pagadas vs pendientes, con totales y Abonar (tarea 5.5)', () => {
  test('separa facturas pagadas de pendientes/parciales, con totales por sección y "Abonar" en las pendientes', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const prop = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, prop.id);
    const vet = await createTestVeterinario(request, admin);

    const ordenPagada = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await anexarServicioOrden(request, ordenPagada.id, { tipo_servicio: 'CONSULTA', nombre_servicio: 'Consulta pagada', precio_unitario: 100 }, admin);
    await cerrarTestOrden(request, ordenPagada.id, admin);
    const resPagada = await facturarOrden(request, ordenPagada.id, { metodo_pago: 'EFECTIVO', total_pagado: 100 }, admin);
    expect(resPagada.ok()).toBeTruthy();

    // Segunda orden: se anexa un servicio directo (sin línea CONSULTA) para
    // que la factura resultante sólo se vincule por FacturaOrden -- es
    // exactamente el caso que agrega la tarea 9.3 al endpoint.
    const ordenPendiente = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id, veterinarioId: vet.id }, admin);
    await anexarServicioOrden(request, ordenPendiente.id, { tipo_servicio: 'CONSULTA', nombre_servicio: 'Consulta pendiente', precio_unitario: 80 }, admin);
    await cerrarTestOrden(request, ordenPendiente.id, admin);
    const resPendiente = await facturarOrden(request, ordenPendiente.id, { total_pagado: 0 }, admin);
    expect(resPendiente.ok()).toBeTruthy();
    const facturaPendiente = await resPendiente.json();

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-consultorio');
    await seleccionarMascotaEnLista(page, mascota.nombre);
    await page.locator('.pet-nav-item[data-tab="facturacion"]').click();

    await expect(page.locator('#facPagadasBody')).toContainText('100', { timeout: 15000 });
    await expect(page.locator('#facPendientesBody')).toContainText('80');
    await expect(page.locator('#facTotalPagadas')).toContainText('100');
    await expect(page.locator('#facTotalPendientes')).toContainText('80');
    // La sección "Pagadas" no ofrece "Abonar" (ya está saldada).
    await expect(page.locator('#facPagadasBody').getByRole('button', { name: 'Abonar' })).toHaveCount(0);

    await page.locator('#facPendientesBody').getByRole('button', { name: 'Abonar' }).click();
    await expect(page.locator('#modal-abono')).toBeVisible();
    await expect(page.locator('#abonoFacturaId')).toHaveValue(String(facturaPendiente.id));

    // Abonar el total: al cerrar el modal, el tab se refresca solo y la
    // factura pasa de "Pendientes" a "Pagadas" sin salir de la ficha.
    await page.fill('#abonoMonto', '80');
    await page.selectOption('#abonoMetodoPago', { index: 1 });
    await page.locator('#form-abono button[type="submit"]').click();
    await expect(page.locator('#modal-abono')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('#facPendientesBody')).not.toContainText('80', { timeout: 10000 });
    await expect(page.locator('#facTotalPagadas')).toContainText('180');
  });
});
