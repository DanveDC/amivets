// e2e/shell.spec.js — Tarea 06, etapa 7: el shell nuevo (barra lateral de 6
// módulos, cabecera de 68px, lanzador, panel del día, orden abierta + su
// panel de anexar servicio, y la bandeja del gestor).
//
// Se agrupa en un archivo nuevo (en vez de repartirlo entre specs existentes)
// porque cubre navegación/shell, no un router de dominio puntual — mismo
// criterio que separó auth.spec.js de los specs de negocio.
//
// Cobertura mínima pedida:
//   1. Login lleva al lanzador de 6 módulos (admin), no directo a una sección
//      de trabajo.
//   2. Recorte de tarjetas por rol: un gestor puro no ve el lanzador y cae
//      directo en su bandeja; un admin ve las 6.
//   3. Recorrido feliz: panel del día -> abrir orden -> anexar servicio
//      (panel, no modal, el total sigue visible) -> confirmar -> la bandeja
//      del gestor la ve -> tomar -> ejecutar.
//   4. La búsqueda global (Ctrl/Cmd+K) sigue funcionando desde el header nuevo.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  TEST_USER_PASSWORD,
  getAdminToken,
  authHeaders,
  testTag,
  createTestUser,
  deleteTestUser,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestOrden,
  createTestArea,
  desactivarTestArea,
  agregarGestorArea,
  createTestGestor,
  createTestVeterinario,
  createTestConsulta,
  createTestFactura,
  deleteTestConsulta,
  anularTestFactura,
  anexarServicioOrden,
  confirmarServiciosOrden,
  cerrarTestOrden,
  gotoSection,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Shell — lanzador y navegación por módulos', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
  });

  test('login (admin) entra al lanzador de los 6 módulos, no a una sección de trabajo', async ({ page }) => {
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);

    await expect(page.locator('#sec-inicio')).toBeVisible();
    await expect(page.locator('#sec-hoy')).toBeHidden();
    // El lanzador no lleva barra lateral (Decisión 2, regla 2).
    await expect(page.locator('.av-sidebar')).toBeHidden();
    await expect(page.locator('.av-launcher-card')).toHaveCount(6);
  });

  test('un gestor puro no ve el lanzador: cae directo en su bandeja', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const { user: gestor } = await createTestGestor(request, adminToken);
    try {
      await loginUI(page, gestor.username, TEST_USER_PASSWORD);

      await expect(page.locator('#sec-inicio')).toBeHidden();
      await expect(page.locator('#sec-bandeja-gestor')).toBeVisible();
      // La barra lateral de un gestor puro sólo tiene el módulo 2.
      await expect(page.locator('.av-nav-item')).toHaveCount(1);
    } finally {
      await deleteTestUser(request, adminToken, gestor.id);
    }
  });

  // Tarea 11, §4 — "probá el lanzador con los cinco roles y confirmá que cada
  // uno ve exactamente lo que puede usar". La matriz (admin 6/6, recepcionista
  // 3/6, veterinario 3/6, gestor 1/6 → sin lanzador) es la que documenta el
  // propio boceto Inicio.html en su nota de diseño; acá se verifica contra la
  // app real, no solo se lee el código.
  test('recepcionista ve 3/6 módulos (Admisión, Mascotas/Tutores, Facturación) y no alcanza Insumos ni por hash directo', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const recepcionista = await createTestUser(request, adminToken, { role: 'recepcionista' });
    try {
      await loginUI(page, recepcionista.username, TEST_USER_PASSWORD);
      await expect(page.locator('#sec-inicio')).toBeVisible();
      await expect(page.locator('.av-launcher-card')).toHaveCount(3);
      await expect(page.locator('.av-launcher-card', { hasText: 'Admisión' })).toBeVisible();
      await expect(page.locator('.av-launcher-card', { hasText: 'Mascotas / Tutores' })).toBeVisible();
      await expect(page.locator('.av-launcher-card', { hasText: 'Facturación' })).toBeVisible();

      // Insumos (sec-inventario, admin-only) no tiene tarjeta...
      await expect(page.locator('.av-launcher-card', { hasText: 'Insumos' })).toHaveCount(0);
      // ...y tampoco es alcanzable escribiendo el hash a mano.
      await page.goto('/#sec-inventario');
      await expect(page.locator('#avNoAccess')).toBeVisible();
      await expect(page.locator('#sec-inventario')).toBeHidden();
    } finally {
      await deleteTestUser(request, adminToken, recepcionista.id);
    }
  });

  test('veterinario ve 3/6 módulos (Admisión, Servicios, Mascotas/Tutores) y no alcanza Facturación ni por hash directo', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const vet = await createTestVeterinario(request, adminToken);
    try {
      await loginUI(page, vet.username, TEST_USER_PASSWORD);
      await expect(page.locator('#sec-inicio')).toBeVisible();
      await expect(page.locator('.av-launcher-card')).toHaveCount(3);
      await expect(page.locator('.av-launcher-card', { hasText: 'Admisión' })).toBeVisible();
      await expect(page.locator('.av-launcher-card', { hasText: 'Servicios' })).toBeVisible();
      await expect(page.locator('.av-launcher-card', { hasText: 'Mascotas / Tutores' })).toBeVisible();

      await expect(page.locator('.av-launcher-card', { hasText: 'Facturación' })).toHaveCount(0);
      await page.goto('/#sec-facturacion');
      await expect(page.locator('#avNoAccess')).toBeVisible();
      await expect(page.locator('#sec-facturacion')).toBeHidden();
    } finally {
      await deleteTestUser(request, adminToken, vet.id);
    }
  });

  test('un usuario sin rol asignado (role="user", el default del modelo) ve el lanzador vacío con explicación, no una grilla en blanco', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const sinRol = await createTestUser(request, adminToken); // createTestUser ya defaultea role:'user'
    try {
      await loginUI(page, sinRol.username, TEST_USER_PASSWORD);
      await expect(page.locator('#sec-inicio')).toBeVisible();
      await expect(page.locator('.av-launcher-card')).toHaveCount(0);
      await expect(page.locator('#inicioGrid .av-empty')).toBeVisible();
      await expect(page.locator('#inicioGrid')).toContainText('no tiene un módulo asignado');
    } finally {
      await deleteTestUser(request, adminToken, sinRol.id);
    }
  });

  test('búsqueda global (Ctrl/Cmd+K) funciona desde el header nuevo', async ({ page }) => {
    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.locator('.av-launcher-card').first().click();

    await expect(page.locator('#cmdkTrigger')).toBeVisible();
    await expect(page.locator('#cmdkTrigger')).toContainText('Buscar mascota o tutor');
    await page.keyboard.press('Control+K');
    await expect(page.locator('.av-cmdk-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.av-cmdk-input')).toHaveCount(0);
  });

  test('búsqueda global encuentra número de orden y número de factura (etapa 8 — Puntos abiertos)', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const orden = await createTestOrden(request, { propietarioId: propietario.id }, adminToken);
    const factura = await createTestFactura(request, { propietarioId: propietario.id });

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);

      // GET /api/ordenes/?numero= es nuevo en esta etapa (antes cmdk.js no
      // buscaba órdenes en absoluto).
      await page.keyboard.press('Control+K');
      await page.locator('.av-cmdk-input').fill(orden.numero);
      const ordenItem = page.locator('.av-cmdk-item', { hasText: orden.numero });
      await expect(ordenItem).toBeVisible({ timeout: 5000 });
      await ordenItem.click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();

      // GET /api/facturas/?search= ya existía en el backend; cmdk.js nunca
      // lo usaba (comentario stale en el código, corregido en esta etapa).
      await page.keyboard.press('Control+K');
      await page.locator('.av-cmdk-input').fill(factura.numero_factura);
      const facturaItem = page.locator('.av-cmdk-item', { hasText: factura.numero_factura });
      await expect(facturaItem).toBeVisible({ timeout: 5000 });
      await facturaItem.click();
      await expect(page.locator('#modalPreviewFactura')).toBeVisible();
      await expect(page.locator('#previewFacturaNumero')).toContainText(factura.numero_factura);
    } finally {
      await deleteTestPropietario(request, propietario.id);
    }
  });
});

test.describe('Listado de mascotas — sec-mascotas (etapa 8, landing nuevo del módulo 3)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
  });

  test('filtra por especie, busca por nombre y abre la ficha desde "Ver ficha"', async ({ page, request }) => {
    const propietario = await createTestPropietario(request);
    // Nombres SIN espacios a propósito: MascotaResponse (schemas.py,
    // append_apellido) reescribe `nombre` en cada serialización como
    // "<primer token> <apellido del tutor>" -- un hallazgo de esta etapa, no
    // algo a corregir acá. Buscar/matchear por el token base (antes del
    // espacio) es estable sin importar cuántas veces se le pegue el apellido.
    const nombrePerro = testTag('Firulais');
    const nombreGato = testTag('Michi');
    const perro = await createTestMascota(request, propietario.id, { nombre: nombrePerro, especie: 'Perro' });
    const gato = await createTestMascota(request, propietario.id, { nombre: nombreGato, especie: 'Gato' });

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await page.locator('.av-launcher-card[data-target="sec-mascotas"]').click();
      await expect(page.locator('#sec-mascotas')).toBeVisible();

      // Búsqueda: sólo el perro de prueba debería quedar visible.
      await page.locator('#mascotasSearch').fill(nombrePerro);
      const filaPerro = page.locator('#mascotasTableBody tr', { hasText: nombrePerro });
      await expect(filaPerro).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#mascotasTableBody tr', { hasText: nombreGato })).toHaveCount(0);
      // Hallazgo de revisión (Tarea 11): el lookup de tutores pedía
      // /propietarios/?limit=200 fijo -- con más tutores que ese límite en la
      // base, la columna Tutor quedaba en "—" sin aviso. La fila debe traer
      // el nombre real, no el guión de "sin tutor".
      await expect(filaPerro).toContainText(propietario.nombre);
      await expect(filaPerro).not.toContainText('—');

      // Filtro por especie "Gatos": limpio la búsqueda y filtro por especie.
      await page.locator('#mascotasSearch').fill('');
      await page.locator('#mascotasFiltros [data-especie="Gato"]').click();
      const filaGato = page.locator('#mascotasTableBody tr', { hasText: nombreGato });
      await expect(filaGato).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#mascotasTableBody tr', { hasText: nombrePerro })).toHaveCount(0);

      // "Ver ficha" navega a la historia clínica del paciente correcto.
      await filaGato.locator('[data-open-mascota]').click();
      await expect(page.locator('#sec-consultorio')).toBeVisible();
      await expect(page.locator('#displayNombreMascota')).toContainText(nombreGato);
    } finally {
      await deleteTestMascota(request, perro.id);
      await deleteTestMascota(request, gato.id);
      await deleteTestPropietario(request, propietario.id);
    }
  });
});

test.describe('Shell — recorrido feliz: orden -> anexar -> confirmar -> bandeja', () => {
  test('panel del día -> orden abierta -> anexar (panel, no modal) -> confirmar -> la bandeja del gestor la ve -> tomar -> ejecutar', async ({ page, request, browser }) => {
    test.setTimeout(90000); // recorrido largo: dos sesiones (admin + gestor), varias navegaciones reales.
    const adminToken = await getAdminToken(request);

    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);
    const area = await createTestArea(request, adminToken, { requiere_adjunto: false });

    const catalogoRes = await request.post('/api/catalogo/', {
      headers: authHeaders(adminToken),
      data: {
        nombre: testTag('Hemograma'),
        categoria: 'LABORATORIO',
        precio_ref: 14,
        precio_variable: false,
        activo: true,
        area_id: area.id,
      },
    });
    expect(catalogoRes.ok()).toBeTruthy();
    const catalogo = await catalogoRes.json();

    const orden = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id },
      adminToken,
    );

    const { user: gestor, token: gestorToken } = await createTestGestor(request, adminToken);
    await agregarGestorArea(request, adminToken, area.id, gestor.id);

    try {
      // ── admin: panel del día -> orden -> anexar -> confirmar ──────────────
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
      await expect(page.locator('#sec-hoy')).toBeVisible();

      const fila = page.locator(`tr[data-orden-id="${orden.id}"]`);
      await expect(fila).toBeVisible({ timeout: 15000 });
      await fila.click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();
      await expect(page.locator('#oaMetaNumero')).toHaveText(orden.numero);

      // Hallazgo de revisión (Tarea 11): .oa-canvas no tenía display:grid, así
      // que el panel "Resumen / Facturar orden" (.oa-side) caía apilado DEBAJO
      // de la tabla de servicios en vez de la columna fija de la derecha que
      // dibuja OrdenAbierta.html -- toBeVisible() no lo detectaba porque el
      // elemento seguía siendo "visible" (solo que fuera del viewport, sin
      // scroll evidente). Se verifica la posición real: el panel de resumen
      // tiene que estar a la derecha de la tabla de servicios, dentro del
      // viewport, no debajo.
      const stackBox = await page.locator('.oa-stack').boundingBox();
      const sideBox = await page.locator('.oa-side').boundingBox();
      expect(sideBox.x, 'el panel Resumen debe quedar a la derecha de los servicios, no debajo').toBeGreaterThan(stackBox.x + stackBox.width - 20);
      expect(sideBox.y, 'el panel Resumen tiene que entrar en el viewport inicial').toBeLessThan(900);

      await page.locator('#btnOaAnexar').click();
      const panel = page.locator('#oaAnexarPanel');
      await expect(panel).toBeVisible();
      // No es un modal: el contenido de la orden (el total) sigue visible al
      // mismo tiempo que el panel de anexar (Decisión 3).
      await expect(page.locator('.modal.show')).toHaveCount(0);
      await expect(page.locator('#oaTotal')).toBeVisible();

      await page.locator('.oa-cat-item[data-cat="LABORATORIO"]').click();
      await page.locator(`.oa-svc-item[data-id="${catalogo.id}"]`).click();
      await page.locator('#btnOaAnexarConfirmar').click();
      await expect(panel).toBeHidden();
      await expect(page.locator('#oaServiciosBody')).toContainText(catalogo.nombre);
      // El total pasa de $0.00 a reflejar el precio del ítem anexado.
      await expect(page.locator('#oaTotal')).toContainText('14.00');

      await page.locator('#btnOaConfirmar').click();
      await expect(page.locator('#oaServiciosBody')).not.toContainText('Solicitado');

      // ── gestor: la bandeja lo ve -> tomar -> ejecutar ─────────────────────
      const gestorContext = await browser.newContext();
      const gestorPage = await gestorContext.newPage();
      try {
        await loginUI(gestorPage, gestor.username, TEST_USER_PASSWORD);
        await expect(gestorPage.locator('#sec-bandeja-gestor')).toBeVisible();

        const filaGestor = gestorPage.locator('#bgQueueBody tr', { hasText: catalogo.nombre });
        await expect(filaGestor).toBeVisible({ timeout: 15000 });
        await filaGestor.locator('.bg-btn-take').click();

        const filaEnProceso = gestorPage.locator('#bgQueueBody tr', { hasText: catalogo.nombre });
        await filaEnProceso.locator('.bg-btn-cargar').click();
        await expect(gestorPage.locator('#bgDetail strong.ser')).toHaveText(catalogo.nombre);

        await gestorPage.locator('#btnBgEjecutar').click();
        await expect(gestorPage.locator('#bgDetail')).toContainText('Nada en proceso', { timeout: 15000 });
      } finally {
        await gestorContext.close();
      }
    } finally {
      await deleteTestUser(request, adminToken, gestor.id);
      await desactivarTestArea(request, adminToken, area.id);
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
    }
  });
});

// Regresiones confirmadas por la revisión de código de la etapa 7 (código sin
// commitear en su momento). Se cubren acá para que no vuelvan a colarse.
test.describe('Shell — regresiones de seguridad y alcance (revisión etapa 7)', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
  });

  test('un username con HTML no se ejecuta ni rompe el sidebar (XSS almacenado, router.js::renderSidebar)', async ({ page, request }) => {
    // El backend sólo valida longitud del username (3-50), no caracteres —
    // cualquier admin puede setear uno con markup. `onerror` en un <img>
    // insertado vía innerHTML SÍ dispara (a diferencia de <script>, que el
    // parser de innerHTML ignora) — es la prueba estándar para este tipo de
    // hallazgo.
    const adminToken = await getAdminToken(request);
    const payload = '<img src=x onerror=window.__avXssFired=true>';
    const victima = await createTestUser(request, adminToken, { role: 'veterinario', username: payload });
    try {
      await page.goto('/login');
      await page.fill('#username', payload);
      await page.fill('#password', TEST_USER_PASSWORD);
      await page.click('#btnLogin');
      await page.waitForURL('**/');

      // Un veterinario tiene más de un módulo visible, así que login lo deja
      // en el lanzador (sec-inicio) — el sidebar (y #avSidebarUser dentro)
      // recién es visible al entrar a un módulo (.av-app--launcher lo oculta
      // por CSS). El innerHTML ya se pintó igual en el primer syncSidebar()
      // del boot; esto sólo espera a que quede visible para poder inspeccionarlo.
      await page.locator('.av-launcher-card').first().click();
      await expect(page.locator('#avSidebarUser')).toBeVisible();

      // No se usa un `window.__flag` global seteado por el onerror: hay OTROS
      // puntos pre-existentes del frontend (fuera de esta revisión — ver
      // reportes.js/usuarios.js/consultorio.js, selects de veterinario que
      // interpolan `${u.username}` sin escapar) que también inyectan el
      // username sin escapar y dispararían ese mismo onerror, dando un falso
      // negativo si este test dependiera de una bandera global. La prueba
      // queda acotada al DOM de #avSidebarUser, que es lo que renderSidebar()
      // controla (hallazgo de revisión, etapa 7).

      // 1) No se creó un <img> real dentro del bloque de usuario — si el
      //    username se hubiera inyectado sin escapar, el navegador lo habría
      //    parseado como un elemento <img>, no como texto.
      await expect(page.locator('#avSidebarUser img')).toHaveCount(0);

      // 2) El texto escapado se ve tal cual, como texto plano.
      await expect(page.locator('.av-sidebar-userinfo strong')).toHaveText(payload);
    } finally {
      await deleteTestUser(request, adminToken, victima.id);
    }
  });

  test('un veterinario en el Panel del día sólo ve sus propias órdenes (alcance por rol, hoy.js::renderOrdenes)', async ({ page, request, browser }) => {
    test.setTimeout(60000);
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);
    const vetA = await createTestVeterinario(request, adminToken);
    const vetB = await createTestVeterinario(request, adminToken);
    const ordenDeA = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id, veterinarioId: vetA.id },
      adminToken,
    );

    try {
      // El admin ve todas las órdenes del panel (sin filtro de veterinario).
      await page.goto('/login');
      await page.fill('#username', ADMIN_CREDENTIALS.username);
      await page.fill('#password', ADMIN_CREDENTIALS.password);
      await page.click('#btnLogin');
      await page.waitForURL('**/');
      await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
      await expect(page.locator('#pdOrdersBody')).not.toContainText('Cargando…', { timeout: 15000 });
      await expect(page.locator(`tr[data-orden-id="${ordenDeA.id}"]`)).toBeVisible();

      // vet B (otro veterinario, sin relación con la orden) NO tiene que
      // verla — antes de este fix, `/ordenes/` se pedía sin `veterinario_id`
      // y cualquier veterinario veía las órdenes de todos los demás.
      const vetBContext = await browser.newContext();
      const vetBPage = await vetBContext.newPage();
      try {
        await vetBPage.goto('/login');
        await vetBPage.fill('#username', vetB.username);
        await vetBPage.fill('#password', TEST_USER_PASSWORD);
        await vetBPage.click('#btnLogin');
        await vetBPage.waitForURL('**/');
        await vetBPage.locator('.av-launcher-card[data-target="sec-hoy"]').click();
        await expect(vetBPage.locator('#pdOrdersBody')).not.toContainText('Cargando…', { timeout: 15000 });
        await expect(vetBPage.locator(`tr[data-orden-id="${ordenDeA.id}"]`)).toHaveCount(0);
      } finally {
        await vetBContext.close();
      }
    } finally {
      await deleteTestUser(request, adminToken, vetA.id);
      await deleteTestUser(request, adminToken, vetB.id);
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
    }
  });

  test('facturar una orden con consulta desde "Orden abierta" setea Factura.consulta_id (fix post etapa 7 — sin esto, la liquidación del veterinario se rompe en silencio)', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);
    const vet = await createTestVeterinario(request, adminToken);

    const orden = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id, veterinarioId: vet.id },
      adminToken,
    );
    const consulta = await createTestConsulta(
      request,
      { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id },
      adminToken,
    );

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
      const fila = page.locator(`tr[data-orden-id="${orden.id}"]`);
      await expect(fila).toBeVisible({ timeout: 15000 });
      await fila.click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();

      // La línea CONSULTA nace EJECUTADA (atajo sin despacho): nada que
      // confirmar. orden-servicio-carrito, decisión 9: "Facturar" solo se
      // habilita con la orden CERRADA -- hay que cerrarla primero (sin
      // pendientes SOLICITADO/ASIGNADO/EN_PROCESO, la única línea que hay es
      // la CONSULTA ya EJECUTADA, así que cierra sin objeciones).
      await page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btnOaCerrar').click();
      await expect(page.locator('.notification-toast')).toContainText(/cerrada/i, { timeout: 10000 });

      // Tarea 11: "Facturar orden" ahora abre el checkout del boceto
      // Facturacion.html (conceptos + forma de pago) en vez de crear la
      // factura directo -- se confirma con "Emitir factura".
      await page.locator('#btnOaFacturar').click();
      await expect(page.locator('#modalFacturarOrden')).toBeVisible();
      await expect(page.locator('#facOrdenTotal')).not.toHaveText('$0.00');
      await page.locator('#btnConfirmarFacturarOrden').click();
      // Filtrado por texto: el toast "Orden cerrada." puede seguir visible.
      await expect(page.locator('.notification-toast', { hasText: /Factura #/ }).first()).toBeVisible({ timeout: 10000 });

      // /api/facturas/ no tiene filtro por consulta_id -- se filtra por
      // propietario_id (que sí soporta) y se busca a mano entre las suyas.
      const facturasRes = await request.get(`/api/facturas/?propietario_id=${propietario.id}&limit=100`, { headers: authHeaders(adminToken) });
      expect(facturasRes.ok()).toBeTruthy();
      const facturas = await facturasRes.json();
      const factura = (Array.isArray(facturas) ? facturas : []).find(f => f.consulta_id === consulta.id);
      expect(factura, 'la factura emitida desde Orden abierta tiene que tener consulta_id seteado').toBeTruthy();
      expect(factura.consulta_id).toBe(consulta.id);
    } finally {
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
      await deleteTestUser(request, adminToken, vet.id);
    }
  });

  test('doble clic en "Emitir factura" no crea dos facturas (revisión 11 — guard cliente + servidor contra doble submit)', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);
    const vet = await createTestVeterinario(request, adminToken);

    const orden = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id, veterinarioId: vet.id },
      adminToken,
    );
    const consulta = await createTestConsulta(
      request,
      { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id },
      adminToken,
    );

    let facturaIdParaAnular = null;
    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await page.locator('.av-launcher-card[data-target="sec-hoy"]').click();
      const fila = page.locator(`tr[data-orden-id="${orden.id}"]`);
      await expect(fila).toBeVisible({ timeout: 15000 });
      await fila.click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();

      // orden-servicio-carrito, decisión 9: Facturar exige la orden CERRADA.
      await page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btnOaCerrar').click();
      await expect(page.locator('.notification-toast')).toContainText(/cerrada/i, { timeout: 10000 });

      await page.locator('#btnOaFacturar').click();
      await expect(page.locator('#modalFacturarOrden')).toBeVisible();
      await expect(page.locator('#facOrdenTotal')).not.toHaveText('$0.00');

      // Doble clic real: antes de la guarda (submitWithLoading deshabilitando
      // el botón + el chequeo server-side de servicios ya facturados), dos
      // clics rápidos mandaban dos POST /facturas/ casi simultáneos con las
      // mismas líneas y creaban dos facturas para la misma orden.
      await page.locator('#btnConfirmarFacturarOrden').dblclick();
      // Filtrado por texto: el toast "Orden cerrada." puede seguir visible.
      await expect(page.locator('.notification-toast', { hasText: /Factura #/ }).first()).toBeVisible({ timeout: 10000 });

      const facturasRes = await request.get(`/api/facturas/?propietario_id=${propietario.id}&limit=100`, { headers: authHeaders(adminToken) });
      expect(facturasRes.ok()).toBeTruthy();
      const facturas = await facturasRes.json();
      const facturasDeConsulta = (Array.isArray(facturas) ? facturas : [])
        .filter(f => f.consulta_id === consulta.id && f.estado !== 'ANULADA');
      expect(facturasDeConsulta.length, 'el doble clic tiene que dejar UNA sola factura activa para la consulta').toBe(1);
      // Se guarda para el cleanup: la FK facturas.consulta_id bloquea el
      // DELETE de la consulta mientras la factura siga activa (mismo criterio
      // que servicios-desde-consulta.spec.js / reportes.spec.js).
      facturaIdParaAnular = facturasDeConsulta[0].id;

      // Backstop de servidor (transacción, revisión 11): un POST directo con
      // un servicio_id que ya está facturado se rechaza con 409 en vez de
      // generar una segunda factura, aunque el guard del cliente fallase.
      const consultaCargada = await (await request.get(`/api/consultas/${consulta.id}`, { headers: authHeaders(adminToken) })).json();
      const lineaConsulta = (consultaCargada.servicios || []).find(s => s.tipo_servicio === 'CONSULTA');
      expect(lineaConsulta, 'la consulta tiene que tener su línea CONSULTA').toBeTruthy();
      expect(lineaConsulta.facturado).toBe(true);

      const reintento = await request.post('/api/facturas/', {
        headers: authHeaders(adminToken),
        data: {
          propietario_id: propietario.id,
          detalles: [{ descripcion: 'reintento PWTEST', cantidad: 1, precio_unitario: 1, servicio_id: lineaConsulta.id }],
        },
      });
      expect(reintento.status(), 'un servicio ya facturado tiene que rechazar un segundo POST con 409').toBe(409);
    } finally {
      // Orden inverso a las dependencias (mismo criterio que
      // servicios-desde-consulta.spec.js::afterAll): la factura activa
      // bloquea el DELETE de la consulta por FK, así que se anula primero.
      if (facturaIdParaAnular) await anularTestFactura(request, facturaIdParaAnular, adminToken);
      await deleteTestConsulta(request, consulta.id);
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
      await deleteTestUser(request, adminToken, vet.id);
    }
  });
});

// orden-servicio-carrito, decisión 8: Facturación abre en "Órdenes por
// cobrar" (no en el historial) y "Cobrar" ahí abre la orden en vez de armar
// una factura en el cliente.
test.describe('Shell — Facturación: Órdenes por cobrar (orden-servicio-carrito)', () => {
  test('una orden CERRADA aparece en "Órdenes por cobrar", se cobra desde ahí y pasa al historial', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);

    const orden = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id },
      adminToken,
    );
    // ESTETICA sin catalogo_servicio_id: sin área conocida. Confirmar la
    // manda directo a EJECUTADO (atajo sin área, decisión 4) y la orden
    // puede cerrarse sin pasar por la bandeja del gestor.
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: testTag('bano'),
      precio_unitario: 9000,
    }, adminToken);
    await confirmarServiciosOrden(request, orden.id, adminToken);
    await cerrarTestOrden(request, orden.id, adminToken);

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await gotoSection(page, 'sec-facturacion');
      await expect(page.locator('#sec-facturacion')).toBeVisible();

      // Vista por defecto: "Órdenes por cobrar", no el historial.
      await expect(page.locator('#facTabOrdenes')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#facViewHistorial')).toBeHidden();
      const filaOrden = page.locator('#facOrdenesBody tr', { hasText: orden.numero });
      await expect(filaOrden).toBeVisible({ timeout: 15000 });
      await expect(filaOrden).toContainText('9000.00');

      // "Cobrar" navega a la orden (no factura desde la lista).
      await filaOrden.getByRole('button', { name: /Cobrar/i }).click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();
      await expect(page.locator('#oaMetaNumero')).toHaveText(orden.numero);

      await page.locator('#btnOaFacturar').click();
      await expect(page.locator('#modalFacturarOrden')).toBeVisible();
      await page.locator('#btnConfirmarFacturarOrden').click();
      // Filtrado por texto: el toast "Orden cerrada." puede seguir visible.
      await expect(page.locator('.notification-toast', { hasText: /Factura #/ }).first()).toBeVisible({ timeout: 10000 });

      // Vuelve a Facturación: la orden ya facturada no está más en "Órdenes
      // por cobrar" (dejó de estar CERRADA) y su factura sí aparece en el
      // historial.
      await gotoSection(page, 'sec-facturacion');
      await expect(page.locator('#facOrdenesBody')).not.toContainText(orden.numero, { timeout: 15000 });
      await page.locator('#facTabHistorial').click();
      await expect(page.locator('#facViewOrdenes')).toBeHidden();
      await expect(page.locator('#facturacionTableBody')).not.toContainText('Cargando', { timeout: 15000 });
      const facturasRes = await request.get(`/api/facturas/?propietario_id=${propietario.id}&limit=10`, { headers: authHeaders(adminToken) });
      const facturas = await facturasRes.json();
      expect(facturas.length, 'la orden cobrada tiene que haber dejado una factura').toBeGreaterThan(0);
      await expect(page.locator('#facturacionTableBody')).toContainText(facturas[0].numero_factura);
    } finally {
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
    }
  });
});

// orden-servicio-carrito, decisión 10: Historia clínica no factura la
// consulta por fuera de su orden -- ofrece "Ir a la orden" en su lugar.
test.describe('Shell — Historia clínica: "Ir a la orden" (orden-servicio-carrito)', () => {
  test('una consulta sin facturar no ofrece "Facturar" y "Ir a la orden" abre su orden', async ({ page, request }) => {
    const adminToken = await getAdminToken(request);
    const propietario = await createTestPropietario(request);
    const mascota = await createTestMascota(request, propietario.id);
    const vet = await createTestVeterinario(request, adminToken);
    const orden = await createTestOrden(
      request,
      { propietarioId: propietario.id, mascotaId: mascota.id, veterinarioId: vet.id },
      adminToken,
    );
    const consulta = await createTestConsulta(
      request,
      { mascotaId: mascota.id, veterinarioId: vet.id, orden_id: orden.id },
      adminToken,
    );

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      const nombreBase = mascota.nombre.split(' ')[0];
      await gotoSection(page, 'sec-consultorio');
      await page.fill('#consultorioSearchMascota', nombreBase);
      const item = page.locator('#consultorioMascotasList .pet-list-item', { hasText: nombreBase }).first();
      await expect(item).toBeVisible({ timeout: 15000 });
      await item.click();
      await expect(page.locator('#patientWrapper')).toBeVisible();
      await page.click('.pet-nav-item[data-tab="consultas"]');

      const seccion = page.locator('#sec-consultorio');
      const irALaOrden = seccion.getByRole('button', { name: /Ir a la orden/ });
      await expect(irALaOrden).toBeVisible({ timeout: 15000 });
      await expect(seccion.getByRole('button', { name: /^\W*Facturar$/ })).toHaveCount(0);

      await irALaOrden.click();
      await expect(page.locator('#sec-orden-abierta')).toBeVisible();
      await expect(page.locator('#oaMetaNumero')).toHaveText(orden.numero);
    } finally {
      await deleteTestConsulta(request, consulta.id);
      await deleteTestMascota(request, mascota.id);
      await deleteTestPropietario(request, propietario.id);
      await deleteTestUser(request, adminToken, vet.id);
    }
  });
});
