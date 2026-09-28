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
