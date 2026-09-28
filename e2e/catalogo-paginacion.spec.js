// @ts-check
// Paginación "Cargar más" del Catálogo (paginacion-catalogo): antes se pedía
// todo de una con ?limit=500 -- pasado ese techo, el resto del catálogo no
// aparecía salvo que se lo buscara por nombre, y el contador
// "N activos · M inactivos" solo contaba lo que ya estaba cargado en
// pantalla. Cubre el contador nuevo (GET /catalogo/contador), el paginado
// por skip/limit de GET /catalogo/, y que "Cargar más" se esconde cuando el
// resultado entra en una sola página.
const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  gotoSection,
} = require('./helpers');

async function loginAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe('Catálogo — paginación "Cargar más" y contador (GET /catalogo/contador)', () => {
  let token;
  const creados = [];

  test.beforeAll(async ({ request }) => {
    token = await getAdminToken(request);
  });

  test.afterAll(async ({ request }) => {
    for (const id of creados) await deleteTestCatalogoServicio(request, id, token);
  });

  test('GET /catalogo/contador coincide con el largo de GET /catalogo/ para un filtro único (3 servicios)', async ({ request }) => {
    const tag = testTag('catPag');
    const nombres = [`${tag}_1`, `${tag}_2`, `${tag}_3`];
    for (const nombre of nombres) {
      const s = await createTestCatalogoServicio(request, { nombre, categoria: 'LABORATORIO' });
      creados.push(s.id);
    }

    const listRes = await request.get(
      `/api/catalogo/?solo_activos=false&limit=500&q=${encodeURIComponent(tag)}`,
      { headers: authHeaders(token) }
    );
    expect(listRes.ok()).toBeTruthy();
    const lista = await listRes.json();
    expect(lista.length).toBe(3);

    const contadorRes = await request.get(`/api/catalogo/contador?q=${encodeURIComponent(tag)}`, {
      headers: authHeaders(token),
    });
    expect(contadorRes.ok(), await contadorRes.text()).toBeTruthy();
    const contador = await contadorRes.json();
    expect(contador.activos).toBe(3);
    expect(contador.inactivos).toBe(0);
    expect(contador.total).toBe(3);
    expect(contador.activos + contador.inactivos).toBe(lista.length);
  });

  test('GET /catalogo/contador separa activos de inactivos y respeta solo_activos', async ({ request }) => {
    const tag = testTag('catPagMix');
    const activo1 = await createTestCatalogoServicio(request, { nombre: `${tag}_activo1`, categoria: 'LABORATORIO' });
    const activo2 = await createTestCatalogoServicio(request, { nombre: `${tag}_activo2`, categoria: 'LABORATORIO' });
    const inactivo = await createTestCatalogoServicio(request, { nombre: `${tag}_inactivo`, categoria: 'LABORATORIO' });
    creados.push(activo1.id, activo2.id, inactivo.id);

    // Soft-delete (DELETE /api/catalogo/{id} pone activo=false).
    await deleteTestCatalogoServicio(request, inactivo.id, token);

    const contadorRes = await request.get(`/api/catalogo/contador?q=${encodeURIComponent(tag)}`, {
      headers: authHeaders(token),
    });
    const contador = await contadorRes.json();
    expect(contador.activos).toBe(2);
    expect(contador.inactivos).toBe(1);
    expect(contador.total).toBe(3);

    const soloActivosRes = await request.get(
      `/api/catalogo/contador?q=${encodeURIComponent(tag)}&solo_activos=true`,
      { headers: authHeaders(token) }
    );
    const soloActivos = await soloActivosRes.json();
    expect(soloActivos.activos).toBe(2);
    expect(soloActivos.inactivos).toBe(1); // el desglose no cambia con solo_activos
    expect(soloActivos.total).toBe(2); // pero el total sí -- no cuenta el inactivo
  });

  test('paginado por skip/limit: dos páginas sin solapamiento y la tercera vacía', async ({ request }) => {
    const tag = testTag('catPagSkip');
    const nombres = [`${tag}_1`, `${tag}_2`, `${tag}_3`, `${tag}_4`];
    for (const nombre of nombres) {
      const s = await createTestCatalogoServicio(request, { nombre, categoria: 'LABORATORIO' });
      creados.push(s.id);
    }

    const pagina1Res = await request.get(
      `/api/catalogo/?solo_activos=false&limit=2&skip=0&q=${encodeURIComponent(tag)}`,
      { headers: authHeaders(token) }
    );
    const pagina1 = await pagina1Res.json();
    expect(pagina1.length).toBe(2);

    const pagina2Res = await request.get(
      `/api/catalogo/?solo_activos=false&limit=2&skip=2&q=${encodeURIComponent(tag)}`,
      { headers: authHeaders(token) }
    );
    const pagina2 = await pagina2Res.json();
    expect(pagina2.length).toBe(2);

    const idsPagina1 = pagina1.map((s) => s.id);
    const idsPagina2 = pagina2.map((s) => s.id);
    expect(idsPagina1.some((id) => idsPagina2.includes(id))).toBe(false);

    // skip=4 con 4 resultados totales: página vacía -- así detecta el front
    // (catalogo.js, cargarPaginaCatalogo) que no hay más para "Cargar más"
    // (pagina.length === PAGE_SIZE_CATALOGO da false apenas la página no
    // viene llena, sin necesitar pedir una página de más).
    const pagina3Res = await request.get(
      `/api/catalogo/?solo_activos=false&limit=2&skip=4&q=${encodeURIComponent(tag)}`,
      { headers: authHeaders(token) }
    );
    const pagina3 = await pagina3Res.json();
    expect(pagina3.length).toBe(0);

    const contadorRes = await request.get(`/api/catalogo/contador?q=${encodeURIComponent(tag)}`, {
      headers: authHeaders(token),
    });
    const contador = await contadorRes.json();
    expect(contador.total).toBe(4);
  });

  test('UI: con un filtro único la lista muestra los 3 servicios, el contador es correcto y "Cargar más" queda oculto', async ({ page, request }) => {
    const tag = testTag('catPagUI');
    const nombres = [`${tag}_1`, `${tag}_2`, `${tag}_3`];
    for (const nombre of nombres) {
      const s = await createTestCatalogoServicio(request, { nombre, categoria: 'LABORATORIO' });
      creados.push(s.id);
    }

    await loginAdmin(page);
    await gotoSection(page, 'sec-catalogo');
    await page.fill('#catalogoSearch', tag);

    for (const nombre of nombres) {
      await expect(page.locator('#catalogoLista')).toContainText(nombre);
    }
    await expect(page.locator('.cat-item')).toHaveCount(3);

    // Contador real (GET /catalogo/contador), no el largo de lo cargado en
    // pantalla -- con 3 servicios nuevos, todos activos.
    await expect(page.locator('#catalogoContador')).toContainText('3 activos');

    // 3 resultados entran en una sola página (PAGE_SIZE_CATALOGO = 100):
    // "Cargar más" no tiene que aparecer.
    await expect(page.locator('#catalogoCargarMas')).toBeHidden();
  });
});
