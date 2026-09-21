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
});
