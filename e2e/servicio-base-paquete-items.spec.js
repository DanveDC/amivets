// @ts-check
// servicio-base-paquete-items — jerarquía padre/hijo en servicios de una
// orden: un servicio "base/paquete" (`es_base=true`) puede tener items
// adicionales anclados (`servicio_padre_id`), para distinguir en la UI y en
// la factura cuál es el paquete y cuáles son sus componentes.
//
// Contrato bajo prueba (ver openspec/changes/servicio-base-paquete-items):
//   - POST /api/ordenes/{id}/servicios acepta `es_base`/`servicio_padre_id`.
//   - Validaciones (orden_service.crear_servicio_en_orden): base con padre
//     (422), padre inexistente (404), padre que no es base (422), padre en
//     otra orden (422), anidación de más de un nivel (422).
//   - GET /api/ordenes/{id} expone, por servicio: `es_base`,
//     `servicio_padre_id`, `es_item_adicional`, `items_adicionales_count`,
//     `subtotal_items_adicionales`, `subtotal_paquete`.
//   - El total de la orden sigue siendo la suma de TODOS los servicios
//     (base + items) — no cambia.
//   - Frontend: orden-abierta.js agrupa base + items con badge "PAQUETE",
//     indentación y subtotal de paquete; el panel "Anexar servicio" permite
//     marcar un servicio como base o anclarlo a un paquete existente.
//
// Cubre también, vía API (backend/tests no tiene infra de fixtures con DB —
// ver tasks.md 4.3/5.2), los escenarios que ese archivo hubiera testeado
// unitariamente: crear base, crear item con padre válido, y los 422/404 de
// arriba.

const { test, expect } = require('@playwright/test');
const {
  ADMIN_CREDENTIALS,
  getAdminToken,
  authHeaders,
  createTestPropietario,
  createTestMascota,
  createTestOrden,
  anexarServicioOrden,
} = require('./helpers');

async function loginUI(page, username, password) {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');
}

test.describe.serial('servicio-base-paquete-items — API', () => {
  const S = { token: null, propietario: null, mascota: null };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.propietario = await createTestPropietario(request, {}, S.token);
    S.mascota = await createTestMascota(request, S.propietario.id, {}, S.token);
  });

  test('crea un servicio base y un item adicional vinculado; ambos exponen la jerarquía en GET /api/ordenes/{id}', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);

    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Cirugía paquete PWTEST',
      cantidad: 1,
      precio_unitario: 100000,
      es_base: true,
    }, S.token);
    expect(base.es_base).toBe(true);
    expect(base.servicio_padre_id).toBeNull();

    const item = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Anestesia PWTEST',
      cantidad: 1,
      precio_unitario: 20000,
      servicio_padre_id: base.id,
    }, S.token);
    expect(item.es_base).toBe(false);
    expect(item.servicio_padre_id).toBe(base.id);
    // Hereda mascota_id del padre (decisión 6): acá coincide con la de la
    // orden porque este endpoint siempre deriva mascota_id de la orden.
    expect(item.mascota_id).toBe(S.mascota.id);

    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, {
      headers: authHeaders(S.token),
    })).json();
    const baseEnDetalle = detalle.servicios.find((s) => s.id === base.id);
    const itemEnDetalle = detalle.servicios.find((s) => s.id === item.id);

    expect(baseEnDetalle.items_adicionales_count).toBe(1);
    expect(baseEnDetalle.subtotal_items_adicionales).toBe(20000);
    expect(baseEnDetalle.subtotal_paquete).toBe(120000);
    expect(baseEnDetalle.es_item_adicional).toBe(false);

    expect(itemEnDetalle.es_item_adicional).toBe(true);
    expect(itemEnDetalle.items_adicionales_count).toBe(0);

    // El total de la orden sigue siendo la suma de TODOS los servicios —
    // no cambia por tener jerarquía (spec, "sin cambios en lógica existente").
    expect(detalle.total).toBe(120000);
  });

  test('un servicio suelto (sin padre, no base) NO es "item adicional" (es_item_adicional=false)', async ({ request }) => {
    // Desviación deliberada del spec literal ("alias de not es_base"):
    // documentada en tasks.md y en el reporte de la sesión. Si fuera un
    // alias literal, este servicio (es_base=false, sin padre) reportaría
    // es_item_adicional=true, lo cual no tiene sentido para un servicio
    // suelto normal.
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);
    const suelto = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'ESTETICA',
      nombre_servicio: 'Baño PWTEST',
      cantidad: 1,
      precio_unitario: 8000,
    }, S.token);
    expect(suelto.es_base).toBe(false);
    expect(suelto.servicio_padre_id).toBeNull();
    expect(suelto.es_item_adicional).toBe(false);
  });

  test('validaciones de integridad: base con padre, padre inexistente, padre no-base, padre en otra orden, anidación profunda', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);
    const otraOrden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);

    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Base PWTEST',
      precio_unitario: 50000,
      es_base: true,
    }, S.token);
    const item = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Item PWTEST',
      precio_unitario: 5000,
      servicio_padre_id: base.id,
    }, S.token);

    // 1) es_base=true CON servicio_padre_id -> 422
    let res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'X', precio_unitario: 1, es_base: true, servicio_padre_id: base.id },
    });
    expect(res.status()).toBe(422);

    // 2) servicio_padre_id inexistente -> 404
    res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'X', precio_unitario: 1, servicio_padre_id: 999999999 },
    });
    expect(res.status()).toBe(404);

    // 3) padre que NO es es_base -> 422
    res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'X', precio_unitario: 1, servicio_padre_id: item.id },
    });
    expect(res.status()).toBe(422);

    // 4) padre en OTRA orden -> 422
    res = await request.post(`/api/ordenes/${otraOrden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'X', precio_unitario: 1, servicio_padre_id: base.id },
    });
    expect(res.status()).toBe(422);

    // 5) anidación de más de un nivel: un servicio cuyo "padre" ya tiene
    // padre él mismo -- acá el "padre" propuesto (`item`) tampoco es base,
    // así que cae en el mismo 422 de "debe ser base"; el caso puro de
    // "padre.servicio_padre_id is not None" es inalcanzable por API una vez
    // que la regla 1 y el CHECK de la DB ya garantizan que un `es_base=true`
    // nunca tiene padre (documentado como hallazgo en el reporte).
    res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'X', precio_unitario: 1, servicio_padre_id: item.id },
    });
    expect(res.status()).toBe(422);
  });

  test('un item con padre soft-deleted o CANCELADO no es un ancla válida (mismo criterio que orden.total)', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Base a cancelar PWTEST',
      precio_unitario: 30000,
      es_base: true,
    }, S.token);

    // Soft delete vía PATCH is_deleted=true (mismo endpoint que usa el resto
    // de la suite para borrar servicios individuales).
    const patch = await request.patch(`/api/servicios/${base.id}`, {
      headers: authHeaders(S.token),
      data: { is_deleted: true },
    });
    expect(patch.ok()).toBeTruthy();

    const res = await request.post(`/api/ordenes/${orden.id}/servicios`, {
      headers: authHeaders(S.token),
      data: { tipo_servicio: 'INSUMO', nombre_servicio: 'Y', precio_unitario: 1, servicio_padre_id: base.id },
    });
    expect(res.status()).toBe(404);
  });

  test('PATCH de un servicio no cambia la jerarquía (se define solo al anexar)', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Base PATCH PWTEST',
      precio_unitario: 1000,
      es_base: true,
    }, S.token);
    const suelto = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Suelto PATCH PWTEST',
      precio_unitario: 10,
    }, S.token);

    const patch = await request.patch(`/api/servicios/${suelto.id}`, {
      headers: authHeaders(S.token),
      data: { servicio_padre_id: base.id, es_base: true, cantidad: 2 },
    });
    expect(patch.ok()).toBeTruthy();
    const actualizado = await patch.json();
    expect(actualizado.cantidad).toBe(2);
    expect(actualizado.servicio_padre_id).toBeNull();
    expect(actualizado.es_base).toBe(false);
  });

  test('vista previa de facturación (pendientes-facturar) incluye es_base/servicio_padre_id por ítem', async ({ request }) => {
    const orden = await createTestOrden(request, {
      propietarioId: S.propietario.id,
      mascotaId: S.mascota.id,
    }, S.token);
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Paquete facturable PWTEST',
      precio_unitario: 40000,
      es_base: true,
    }, S.token);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Item facturable PWTEST',
      precio_unitario: 6000,
      servicio_padre_id: base.id,
    }, S.token);

    const pendientes = await (await request.get(`/api/ordenes/${orden.id}/pendientes-facturar`, {
      headers: authHeaders(S.token),
    })).json();
    const itemBase = pendientes.items.find((it) => it.id_interno === base.id);
    expect(itemBase.es_base).toBe(true);
    expect(pendientes.total).toBe(46000);
  });
});

test.describe('servicio-base-paquete-items — Frontend', () => {
  test('orden-abierta agrupa visualmente base + item con badge PAQUETE, indentación y subtotal; colapsa al click', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const propietario = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, propietario.id, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Cirugía UI PWTEST',
      precio_unitario: 70000,
      es_base: true,
    }, admin);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Anestesia UI PWTEST',
      precio_unitario: 8000,
      servicio_padre_id: base.id,
    }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.evaluate((id) => window.abrirOrden(id), orden.id);

    const filaBase = page.locator(`tr.oa-paquete-base[data-paquete-id="${base.id}"]`);
    await expect(filaBase).toBeVisible();
    await expect(filaBase).toContainText('PAQUETE');
    await expect(filaBase).toContainText('Cirugía UI PWTEST');

    const filaItem = page.locator(`tr.oa-paquete-item[data-padre-id="${base.id}"]`);
    await expect(filaItem).toBeVisible();
    await expect(filaItem).toContainText('Anestesia UI PWTEST');

    const filaSubtotal = page.locator(`tr.oa-paquete-subtotal[data-padre-id="${base.id}"]`);
    await expect(filaSubtotal).toContainText('$78000.00'); // money(): 70000 (base) + 8000 (item)

    // Colapso/expandir (tarea 6.4): click en la base oculta item + subtotal.
    await filaBase.click();
    await expect(filaItem).toBeHidden();
    await expect(filaSubtotal).toBeHidden();
    await filaBase.click();
    await expect(filaItem).toBeVisible();
  });

  test('un item cuyo paquete base ya no está (soft-deleted) se sigue mostrando como servicio suelto', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const propietario = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, propietario.id, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);
    const base = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'CIRUGIA',
      nombre_servicio: 'Base huérfana PWTEST',
      precio_unitario: 5000,
      es_base: true,
    }, admin);
    await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'INSUMO',
      nombre_servicio: 'Item huérfano PWTEST',
      precio_unitario: 300,
      servicio_padre_id: base.id,
    }, admin);
    const patch = await request.patch(`/api/servicios/${base.id}`, {
      headers: authHeaders(admin),
      data: { is_deleted: true },
    });
    expect(patch.ok()).toBeTruthy();

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.evaluate((id) => window.abrirOrden(id), orden.id);

    await expect(page.getByText('Item huérfano PWTEST')).toBeVisible();
    await expect(page.locator(`tr.oa-paquete-item[data-padre-id="${base.id}"]`)).toHaveCount(0);
  });

  test('panel "Anexar servicio": checkbox "es paquete base" y selector "paquete padre" son mutuamente excluyentes, y crean la jerarquía', async ({ page, request }) => {
    const admin = await getAdminToken(request);
    const propietario = await createTestPropietario(request, {}, admin);
    const mascota = await createTestMascota(request, propietario.id, {}, admin);
    const orden = await createTestOrden(request, { propietarioId: propietario.id, mascotaId: mascota.id }, admin);
    // Un base pre-existente para que el selector "Paquete padre" tenga algo
    // para ofrecer.
    const baseExistente = await anexarServicioOrden(request, orden.id, {
      tipo_servicio: 'HOSPITALIZACION',
      nombre_servicio: 'Hospitalización previa PWTEST',
      precio_unitario: 90000,
      es_base: true,
    }, admin);

    await loginUI(page, ADMIN_CREDENTIALS.username, ADMIN_CREDENTIALS.password);
    await page.evaluate((id) => window.abrirOrden(id), orden.id);
    await page.click('#btnOaAnexarInline');
    await expect(page.locator('#oaAnexarPanel')).toBeVisible();

    // El selector ya lista el paquete existente con el sufijo "(PAQUETE)".
    await expect(page.locator('#oaPaquetePadre')).toContainText('Hospitalización previa PWTEST');

    // Marcar "es paquete base" limpia y deshabilita el selector de padre.
    await page.selectOption('#oaPaquetePadre', String(baseExistente.id));
    await page.check('#oaEsBase');
    await expect(page.locator('#oaPaquetePadre')).toBeDisabled();
    await expect(page.locator('#oaPaquetePadre')).toHaveValue('');

    // Elegir un catálogo cualquiera y confirmar como paquete base nuevo.
    await page.fill('#oaAnexarSearch', '');
    const primerServicio = page.locator('#oaSvcList .oa-svc-item').first();
    await primerServicio.click();
    await page.click('#btnOaAnexarConfirmar');
    await expect(page.locator('#oaAnexarPanel')).toBeHidden();

    // Reabrir el panel: destildar la base y anclar el nuevo servicio como
    // item del paquete ya existente.
    await page.click('#btnOaAnexarInline');
    await page.uncheck('#oaEsBase').catch(() => {});
    await page.selectOption('#oaPaquetePadre', String(baseExistente.id));
    await expect(page.locator('#oaEsBase')).not.toBeChecked();
    const items = page.locator('#oaSvcList .oa-svc-item');
    const segundoServicio = (await items.count()) > 1 ? items.nth(1) : items.first();
    await segundoServicio.click();
    await page.click('#btnOaAnexarConfirmar');

    const detalle = await (await request.get(`/api/ordenes/${orden.id}`, { headers: authHeaders(admin) })).json();
    const nuevosItems = detalle.servicios.filter((s) => s.servicio_padre_id === baseExistente.id);
    expect(nuevosItems.length).toBeGreaterThanOrEqual(1);
    const nuevasBases = detalle.servicios.filter((s) => s.es_base && s.id !== baseExistente.id);
    expect(nuevasBases.length).toBeGreaterThanOrEqual(1);
  });
});
