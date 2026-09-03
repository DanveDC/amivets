// Unidad — Catálogo de servicios (backend/app/routers/catalogo.py)
//
// Cubre el CRUD completo de /api/catalogo:
//   GET /categorias · GET / (listar) · POST / · GET /{id} · PUT /{id} · DELETE /{id}
//
// Criterio UI vs API (igual que flujo-clinico.spec.js): el alta y la edición
// se manejan por la UI porque el modal de Catálogo (#modalCatalogoServicio) es
// un formulario nativo estable, accesible como admin desde
// `.menu-item[data-target="sec-catalogo"]` (setupNavigation -> cargarCatalogo).
// El resto (categorías, GET puntual, DELETE) va por API y se comenta.
// Toda mutación se contrasta después con un GET a la API.
//
// Nada se mockea acá: no interviene Supabase / QR.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  testTag,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
} = require('./helpers');

async function loginAsAdmin(page) {
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

// Serial: el test de UI crea el servicio que los tests siguientes editan y
// borran. Con workers:1 esto es determinista; `.serial` solo hace explícito
// que un fallo temprano corta la cadena.
test.describe.serial('Catálogo de servicios — CRUD /api/catalogo', () => {
  const S = { token: null, servicioUI: null, servicioAPI: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
  });

  test.afterAll(async ({ request }) => {
    // Limpieza best-effort — ninguna lanza.
    if (S.servicioUI?.id) await deleteTestCatalogoServicio(request, S.servicioUI.id);
    if (S.servicioAPI?.id) await deleteTestCatalogoServicio(request, S.servicioAPI.id);
  });

  test('GET /categorias devuelve la lista de categorías activas (solo strings)', async ({ request }) => {
    const res = await request.get('/api/catalogo/categorias');
    expect(res.ok()).toBeTruthy();
    const categorias = await res.json();
    expect(Array.isArray(categorias)).toBe(true);
    expect(categorias.length).toBeGreaterThan(0);
    // El endpoint hace SELECT DISTINCT categoria: todo elemento es un string.
    for (const c of categorias) expect(typeof c).toBe('string');
    // Está ordenada alfabéticamente (order_by categoria).
    const ordenada = [...categorias].sort();
    expect(categorias).toEqual(ordenada);
  });

  test('alta por UI: el modal crea el servicio y aparece en la API', async ({ page, request }) => {
    const nombre = testTag('catUI');

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-catalogo"]');
    await expect(page.locator('#sec-catalogo')).toBeVisible();

    await page.click('button:has-text("+ Nuevo Servicio")');
    await expect(page.locator('#modalCatalogoServicio')).toBeVisible();
    await page.fill('#catalogoNombre', nombre);
    await page.selectOption('#catalogoCategoria', 'LABORATORIO');
    await page.fill('#catalogoPrecioRef', '4200.50');
    await page.fill('#catalogoUnidad', 'estudio');
    await page.check('#catalogoPrecioVariable');
    await page.click('#formCatalogoServicio button[type="submit"]');
    await expect(page.locator('#modalCatalogoServicio')).toBeHidden();

    // Contraste API: existe, activo, con los valores cargados.
    const listRes = await request.get('/api/catalogo/?solo_activos=false&limit=500', { headers: authHeaders(S.token) });
    const items = await listRes.json();
    const creado = items.find((s) => s.nombre === nombre);
    expect(creado, 'el servicio creado por UI debe aparecer en la API').toBeTruthy();
    expect(creado.categoria).toBe('LABORATORIO');
    expect(creado.precio_ref).toBeCloseTo(4200.5, 2);
    expect(creado.precio_variable).toBe(true);
    expect(creado.unidad).toBe('estudio');
    expect(creado.activo).toBe(true);
    S.servicioUI = creado;

    // guardarServicio() llama cargarCatalogo() al cerrar: la fila ya está en la tabla.
    await page.fill('#catalogoSearch', nombre);
    await expect(page.locator('#catalogoBody')).toContainText(nombre);
  });

  test('edición por UI: cambiar nombre, categoría y precio, contrastado contra la API', async ({ page, request }) => {
    const nuevoNombre = `${S.servicioUI.nombre}_edit`;

    await loginAsAdmin(page);
    await page.click('.menu-item[data-target="sec-catalogo"]');
    await page.fill('#catalogoSearch', S.servicioUI.nombre);
    await expect(page.locator('#catalogoBody')).toContainText(S.servicioUI.nombre);

    await page.click(`#catalogoBody tr:has-text("${S.servicioUI.nombre}") button:has-text("Editar")`);
    await expect(page.locator('#modalCatalogoServicio')).toBeVisible();
    // abrirModalServicio(id) hace GET /catalogo/{id} y prellena el form.
    await expect(page.locator('#catalogoNombre')).toHaveValue(S.servicioUI.nombre);

    await page.fill('#catalogoNombre', nuevoNombre);
    await page.selectOption('#catalogoCategoria', 'QUIROFANO');
    await page.fill('#catalogoPrecioRef', '99999');
    await page.click('#formCatalogoServicio button[type="submit"]');
    await expect(page.locator('#modalCatalogoServicio')).toBeHidden();

    // Contraste API: GET /{id} refleja la edición.
    const getRes = await request.get(`/api/catalogo/${S.servicioUI.id}`, { headers: authHeaders(S.token) });
    expect(getRes.ok()).toBeTruthy();
    const actualizado = await getRes.json();
    expect(actualizado.nombre).toBe(nuevoNombre);
    expect(actualizado.categoria).toBe('QUIROFANO');
    expect(actualizado.precio_ref).toBeCloseTo(99999, 2);
    S.servicioUI = actualizado;
  });

  test('POST / y PUT /{id} por API: alta, edición parcial y GET puntual', async ({ request }) => {
    // Por API: el modal solo cubre alta+edición completas; acá se ejerce el
    // PUT parcial (exclude_unset) y el 404 del GET puntual inexistente.
    S.servicioAPI = await createTestCatalogoServicio(request, { categoria: 'FARMACIA', precio_ref: 1500 });
    expect(S.servicioAPI.id).toBeTruthy();
    expect(S.servicioAPI.activo).toBe(true);

    const getRes = await request.get(`/api/catalogo/${S.servicioAPI.id}`, { headers: authHeaders(S.token) });
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).categoria).toBe('FARMACIA');

    // PUT parcial: solo precio_ref; nombre/categoria intactos.
    const putRes = await request.put(`/api/catalogo/${S.servicioAPI.id}`, {
      headers: authHeaders(S.token),
      data: { precio_ref: 3300, precio_variable: true },
    });
    expect(putRes.ok(), await putRes.text()).toBeTruthy();
    const actualizado = await putRes.json();
    expect(actualizado.precio_ref).toBeCloseTo(3300, 2);
    expect(actualizado.precio_variable).toBe(true);
    expect(actualizado.nombre).toBe(S.servicioAPI.nombre); // no tocado

    // GET puntual inexistente -> 404.
    const missing = await request.get('/api/catalogo/99999999', { headers: authHeaders(S.token) });
    expect(missing.status()).toBe(404);
  });

  test('filtro por categoría y búsqueda de texto en GET /', async ({ request }) => {
    const res = await request.get(`/api/catalogo/?categoria=FARMACIA&q=${encodeURIComponent(S.servicioAPI.nombre)}&solo_activos=true`);
    expect(res.ok()).toBeTruthy();
    const items = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const s of items) expect(s.categoria).toBe('FARMACIA');
    expect(items.some((s) => s.id === S.servicioAPI.id)).toBe(true);
  });

  test('DELETE /{id} es borrado lógico: 204, desaparece de solo_activos, sigue con GET puntual', async ({ request }) => {
    const delRes = await request.delete(`/api/catalogo/${S.servicioAPI.id}`, { headers: authHeaders(S.token) });
    expect(delRes.status()).toBe(204);

    // Ya no aparece con solo_activos=true (default).
    const activosRes = await request.get('/api/catalogo/?limit=500');
    const activos = await activosRes.json();
    expect(activos.some((s) => s.id === S.servicioAPI.id)).toBe(false);

    // Sigue existiendo (activo=false) — el GET puntual no filtra por activo.
    const getRes = await request.get(`/api/catalogo/${S.servicioAPI.id}`);
    expect(getRes.ok()).toBeTruthy();
    expect((await getRes.json()).activo).toBe(false);

    // Borrar de nuevo un id inexistente -> 404.
    const missing = await request.delete('/api/catalogo/99999999', { headers: authHeaders(S.token) });
    expect(missing.status()).toBe(404);
  });
});
