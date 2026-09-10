// Tarea 07 — Inventario fraccionado (consumo de materiales por receta)
//
// Los 7 casos de la sección "Pruebas" de docs/tareas/07-inventario-materiales-
// fraccionados.md, todos por API (fixture `request` + helpers), en serie porque
// comparten backend. Contrato ejercitado (slices A/B/C/D):
//
//   - Un ServicioConsulta que entra en estado "Aplicado" con `catalogo_servicio_id`
//     descuenta la receta de ese servicio del stock (Numeric(12,3), exacto).
//   - `consumos: [{inventario_id, cantidad}]` sobreescribe la cantidad de la
//     receta por material; las líneas sin override usan la cantidad estándar.
//   - Sin stock suficiente y con STRICT_INVENTORY=false (default): HTTP 200/201,
//     `advertencias: [{material, faltante, unidad}]`, el stock puede quedar negativo.
//   - Revertir (PATCH estado != "Aplicado" o DELETE) devuelve EXACTAMENTE lo
//     consumido, leyendo ConsumoMaterial (no recalcula la receta).
//   - Facturar después de aplicar no vuelve a descontar (la línea lleva
//     servicio_id, nunca producto_id).
//   - `stock_actual` se serializa como número JSON de 3 decimales, puede ser < 0.
//
// No se toca flujo-clinico.spec.js ni clinico.spec.js.

const { test, expect } = require('@playwright/test');
const {
  getAdminToken,
  authHeaders,
  testTag,
  createTestProduct,
  deleteTestProduct,
  createTestPropietario,
  deleteTestPropietario,
  createTestMascota,
  deleteTestMascota,
  createTestVeterinario,
  deleteTestUser,
  createTestConsulta,
  deleteTestConsulta,
  createTestCatalogoServicio,
  deleteTestCatalogoServicio,
  createTestFactura,
  anularTestFactura,
} = require('./helpers');

/**
 * Crea un material de inventario (tipo_item MATERIAL) en unidad base.
 * helpers.js sólo tiene createTestProduct (que nace como PRODUCTO); esto es el
 * atajo para la variante consumible de la Tarea 07.
 */
async function createTestMaterial(request, overrides = {}) {
  return createTestProduct(request, {
    categoria: 'Insumo',
    tipo_item: 'MATERIAL',
    unidad_medida: 'ml',
    contenido_por_envase: 1000,
    stock_actual: 2000,
    stock_minimo: 100,
    precio_unitario: 10,
    ...overrides,
  });
}

/** Crea un servicio de catálogo + su receta (una línea de material). */
async function createServicioConReceta(request, { inventarioId, cantidad, unidad = 'ml' }) {
  const servicio = await createTestCatalogoServicio(request, { categoria: 'LABORATORIO', precio_ref: 100 });
  const recRes = await request.post(`/api/catalogo/${servicio.id}/recetas`, {
    data: { inventario_id: inventarioId, cantidad, unidad_medida: unidad },
  });
  if (!recRes.ok()) {
    throw new Error(`[amivets-e2e] Failed to create receta: ${recRes.status()} ${await recRes.text()}`);
  }
  return servicio;
}

/** Lee el stock crudo (número JSON) de un material. */
async function stockOf(request, id) {
  const body = await (await request.get(`/api/inventario/${id}`)).json();
  return body.stock_actual;
}

/** Aplica un servicio de catálogo dentro de la consulta (estado directo "Aplicado"). */
async function aplicarServicio(request, consultaId, catalogoServicioId, extra = {}) {
  const res = await request.post(`/api/consultas/${consultaId}/servicios`, {
    data: {
      consulta_id: consultaId,
      tipo_servicio: 'LABORATORIO',
      nombre_servicio: testTag('servAplic'),
      cantidad: 1,
      precio_unitario: 100,
      estado: 'Aplicado',
      catalogo_servicio_id: catalogoServicioId,
      ...extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

test.describe.serial('Inventario fraccionado — consumo de materiales por receta (Tarea 07)', () => {
  const S = {
    token: null,
    propietario: null,
    mascota: null,
    vet: null,
    consulta: null,
    materiales: [],
    servicios: [],
    facturas: [],
  };

  test.beforeAll(async ({ request }) => {
    S.token = await getAdminToken(request);
    S.propietario = await createTestPropietario(request);
    S.mascota = await createTestMascota(request, S.propietario.id);
    S.vet = await createTestVeterinario(request, S.token);
    S.consulta = await createTestConsulta(request, { mascotaId: S.mascota.id, veterinarioId: S.vet.id });
  });

  test.afterAll(async ({ request }) => {
    for (const id of S.facturas) await anularTestFactura(request, id);
    for (const id of S.servicios) await deleteTestCatalogoServicio(request, id);
    if (S.consulta?.id) await deleteTestConsulta(request, S.consulta.id);
    for (const id of S.materiales) await deleteTestProduct(request, id);
    if (S.vet?.id) await deleteTestUser(request, S.token, S.vet.id);
    if (S.mascota?.id) await deleteTestMascota(request, S.mascota.id);
    if (S.propietario?.id) await deleteTestPropietario(request, S.propietario.id);
  });

  // Registra ids para limpieza y devuelve {material, servicio}.
  async function nuevoEscenario(request, { stock, receta }) {
    const material = await createTestMaterial(request, { stock_actual: stock });
    S.materiales.push(material.id);
    const servicio = await createServicioConReceta(request, { inventarioId: material.id, cantidad: receta });
    S.servicios.push(servicio.id);
    return { material, servicio };
  }

  test('1. receta 500 sobre stock 2000 → al aplicar el material queda en 1500', async ({ request }) => {
    const { material, servicio } = await nuevoEscenario(request, { stock: 2000, receta: 500 });

    const resp = await aplicarServicio(request, S.consulta.id, servicio.id);
    expect(resp.catalogo_servicio_id).toBe(servicio.id);
    expect(resp.advertencias ?? null).toBeNull();

    const stock = await stockOf(request, material.id);
    expect(Number(stock)).toBe(1500);
  });

  test('2. aplicar la receta 500 cuatro veces sobre 2000 → stock final exactamente 0', async ({ request }) => {
    const { material, servicio } = await nuevoEscenario(request, { stock: 2000, receta: 500 });

    for (let i = 0; i < 4; i++) {
      const resp = await aplicarServicio(request, S.consulta.id, servicio.id);
      expect(resp.advertencias ?? null).toBeNull();
    }

    const body = await (await request.get(`/api/inventario/${material.id}`)).json();
    expect(Number(body.stock_actual)).toBe(0);
    // Ni -0.001 ni 0.001: el Numeric decimal no arrastra cola binaria.
    expect(body.stock_actual == 0).toBe(true); // eslint-disable-line eqeqeq
    expect(String(body.stock_actual)).not.toMatch(/0\.001$/);
  });

  test('3. aplicar con stock insuficiente (receta 500, stock 300) avisa y deja -200, consistente en dos corridas', async ({ request }) => {
    for (let corrida = 1; corrida <= 2; corrida++) {
      const { material, servicio } = await nuevoEscenario(request, { stock: 300, receta: 500 });

      const resp = await aplicarServicio(request, S.consulta.id, servicio.id);
      expect(Array.isArray(resp.advertencias), `corrida ${corrida}: advertencias es lista`).toBe(true);
      expect(resp.advertencias.length).toBe(1);
      const a = resp.advertencias[0];
      expect(a.material).toBe(material.nombre);
      expect(Number(a.faltante)).toBe(200);
      expect(a.unidad).toBe('ml');

      const stock = await stockOf(request, material.id);
      expect(Number(stock), `corrida ${corrida}: stock`).toBe(-200);
    }
  });

  test('4. anular devuelve exactamente lo consumido (receta y override), leyendo ConsumoMaterial', async ({ request }) => {
    // 4a. receta estándar: 2000 -> 1500 -> (PATCH a Pendiente) -> 2000 exacto.
    const a = await nuevoEscenario(request, { stock: 2000, receta: 500 });
    const servA = await aplicarServicio(request, S.consulta.id, a.servicio.id);
    expect(Number(await stockOf(request, a.material.id))).toBe(1500);

    const patchRes = await request.patch(`/api/consultas/servicios/${servA.id}`, {
      data: { estado: 'Pendiente' },
    });
    expect(patchRes.ok(), await patchRes.text()).toBeTruthy();
    expect(Number(await stockOf(request, a.material.id))).toBe(2000);

    // 4b. override con fracción: 2000 -> (2000 - 123.456) -> (DELETE) -> 2000 exacto.
    // La reversa lee ConsumoMaterial, no la cantidad de la receta (500).
    const b = await nuevoEscenario(request, { stock: 2000, receta: 500 });
    const servB = await aplicarServicio(request, S.consulta.id, b.servicio.id, {
      consumos: [{ inventario_id: b.material.id, cantidad: 123.456 }],
    });
    expect(Number(await stockOf(request, b.material.id))).toBe(2000 - 123.456);

    const delRes = await request.delete(`/api/consultas/servicios/${servB.id}`);
    expect(delRes.status()).toBe(204);
    expect(Number(await stockOf(request, b.material.id))).toBe(2000);
  });

  test('5. facturar después de aplicar no descuenta dos veces', async ({ request }) => {
    const { material, servicio } = await nuevoEscenario(request, { stock: 2000, receta: 500 });

    const serv = await aplicarServicio(request, S.consulta.id, servicio.id);
    const stockTrasAplicar = Number(await stockOf(request, material.id));
    expect(stockTrasAplicar).toBe(1500);

    const factura = await createTestFactura(request, {
      propietarioId: S.mascota.propietario_id,
      consultaId: S.consulta.id,
      detalles: [
        { descripcion: 'PWTEST servicio con receta', cantidad: 1, precio_unitario: 100, servicio_id: serv.id },
      ],
    });
    S.facturas.push(factura.id);
    expect(factura.consulta_id).toBe(S.consulta.id);
    // Ninguna línea lleva producto_id → la facturación no toca inventario.
    expect(factura.detalles.every((d) => d.producto_id == null)).toBe(true);

    const stockTrasFacturar = Number(await stockOf(request, material.id));
    expect(stockTrasFacturar).toBe(stockTrasAplicar);
  });

  test('6. stock mínimo con decimales: 4.5/5 entra en bajo stock, 5.5/5 no', async ({ request }) => {
    const bajo = await createTestMaterial(request, { stock_actual: 4.5, stock_minimo: 5 });
    S.materiales.push(bajo.id);
    const ok = await createTestMaterial(request, { stock_actual: 5.5, stock_minimo: 5 });
    S.materiales.push(ok.id);

    const bajoStock = await (await request.get('/api/inventario/?bajo_stock=true&limit=2000')).json();
    expect(bajoStock.some((p) => p.id === bajo.id)).toBe(true);
    expect(bajoStock.some((p) => p.id === ok.id)).toBe(false);

    const alertas = await (await request.get('/api/inventario/alertas-stock')).json();
    expect(alertas.some((p) => p.id === bajo.id)).toBe(true);
    expect(alertas.some((p) => p.id === ok.id)).toBe(false);
  });

  test('7. migración sin pérdida: stock entero sale como número y un movimiento fraccionado deja fracción', async ({ request }) => {
    // Producto "clásico" con stock entero (como los migrados de Integer a Numeric).
    const prod = await createTestProduct(request, { stock_actual: 10, stock_minimo: 5 });
    S.materiales.push(prod.id);

    const body = await (await request.get(`/api/inventario/${prod.id}`)).json();
    expect(typeof body.stock_actual).toBe('number');
    expect(body.stock_actual).toBe(10);

    // Un movimiento de 2.5 deja 7.5 → la columna es numérica, no trunca a entero.
    const movRes = await request.post(`/api/inventario/${prod.id}/movimiento`, {
      params: { cantidad: '2.5', tipo: 'SALIDA' },
    });
    expect(movRes.ok(), await movRes.text()).toBeTruthy();
    const tras = await (await request.get(`/api/inventario/${prod.id}`)).json();
    expect(Number(tras.stock_actual)).toBe(7.5);
  });
});
