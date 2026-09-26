// @ts-check
// Áreas y gestores (areas-y-gestores): el admin crea la cuenta del gestor,
// arma el área con sus gestores y servicios, y lo que se confirma en una
// orden cae en la bandeja de ese gestor.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestPropietario,
  createTestMascota,
  createTestOrden,
  createTestGestor,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  desactivarTestArea,
  anexarServicioOrden,
  confirmarServiciosOrden,
  listarBandeja,
  gotoSection,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Áreas y gestores', () => {
  test('el admin crea una cuenta con rol gestor desde Usuarios', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const username = testTag('gestorui');

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await gotoSection(page, 'sec-usuarios');
    await page.click('#btnShowModalUser');
    await page.fill('#userUsername', username);
    await page.fill('#userEmail', `${username}@example.com`);
    await page.fill('#userPassword', 'Password123!');
    await page.selectOption('#userRole', 'gestor');
    page.once('dialog', d => d.accept());
    await page.click('#formNuevoUsuario button[type="submit"]');

    await expect.poll(async () => {
      const usuarios = await (await request.get('/api/usuarios/', { headers: authHeaders(admin) })).json();
      return usuarios.find(u => u.username === username)?.role;
    }, { timeout: 15000 }).toBe('gestor');
  });

  test('el admin arma un área con gestor y servicio, y la orden cae en la bandeja del gestor', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const gestor = await createTestGestor(request, admin);
    const cat = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', precio_ref: 1500 });
    const codigo = testTag('AREAUI').toUpperCase();
    const nombreArea = testTag('Hospitalización');
    let areaId = null;

    try {
      await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
      await gotoSection(page, 'sec-areas');
      await expect(page.locator('#sec-areas')).toBeVisible();

      // Alta del área, que exige adjunto.
      await page.click('#btnAreaNueva');
      await page.fill('#areaNombre', nombreArea);
      await page.fill('#areaCodigo', codigo);
      await page.check('#areaRequiereAdjunto');
      await page.click('#btnGuardarArea');
      await expect(page.locator('#areasLista .cat-item', { hasText: nombreArea })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#areaAsignaciones')).toBeVisible();

      const areas = await (await request.get('/api/areas/', { headers: authHeaders(admin) })).json();
      const area = areas.find(a => a.codigo === codigo);
      expect(area).toBeTruthy();
      expect(area.requiere_adjunto).toBe(true);
      areaId = area.id;

      // Gestor.
      await page.selectOption('#areaGestorSelect', String(gestor.user.id));
      await page.click('#btnAreaAgregarGestor');
      await expect(page.locator('#areaGestoresLista')).toContainText(gestor.user.username, { timeout: 15000 });
      const gestores = await (await request.get(`/api/areas/${areaId}/gestores`, { headers: authHeaders(admin) })).json();
      expect(gestores.map(g => g.usuario_id)).toContain(gestor.user.id);

      // Servicio del catálogo.
      await page.selectOption('#areaServicioSelect', String(cat.id));
      await page.click('#btnAreaAgregarServicio');
      await expect(page.locator('#areaServiciosLista')).toContainText(cat.nombre, { timeout: 15000 });
      const catActual = await (await request.get(`/api/catalogo/${cat.id}`, { headers: authHeaders(admin) })).json();
      expect(catActual.area_id).toBe(areaId);

      // Una orden con ese servicio, confirmada, queda en la bandeja del gestor.
      const prop = await createTestPropietario(request, {}, admin);
      const mascota = await createTestMascota(request, prop.id);
      const orden = await createTestOrden(request, { propietarioId: prop.id, mascotaId: mascota.id }, admin);
      const srv = await anexarServicioOrden(request, orden.id, {
        catalogo_servicio_id: cat.id, tipo_servicio: 'LABORATORIO', nombre_servicio: cat.nombre, precio_unitario: 1500,
      }, admin);
      await confirmarServiciosOrden(request, orden.id, admin);
      const bandeja = await listarBandeja(request, gestor.token);
      const enBandeja = bandeja.find(s => s.id === srv.id);
      expect(enBandeja).toBeTruthy();
      expect(enBandeja.area_id).toBe(areaId);

      // Quitar el servicio lo devuelve a "sin área".
      await page.locator(`[data-quitar-servicio="${cat.id}"]`).click();
      await expect(page.locator('#areaServiciosLista')).not.toContainText(cat.nombre, { timeout: 15000 });
      const catSinArea = await (await request.get(`/api/catalogo/${cat.id}`, { headers: authHeaders(admin) })).json();
      expect(catSinArea.area_id).toBeNull();
    } finally {
      if (areaId) await desactivarTestArea(request, admin, areaId);
      await deleteTestCatalogoServicio(request, cat.id, admin);
    }
  });

  test('un no-admin no ve la pantalla de áreas ni lista sus gestores', async ({ request }) => {
    const admin = await getAdminToken(request);
    const gestor = await createTestGestor(request, admin);
    const res = await request.get('/api/areas/1/gestores', { headers: authHeaders(gestor.token) });
    expect(res.status()).toBe(403);
  });
});
