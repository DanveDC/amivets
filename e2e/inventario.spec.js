// Unidad A — Inventario (backend/app/routers/inventario.py)
//
// The only real change here is in registrar_movimiento(): it now logs a
// low-stock warning when stock_actual <= stock_minimo after a movement.
// This is an API-level check (no UI involved) — we only need to confirm
// the response is still correct when that threshold is crossed, and that
// the pre-existing validation (insufficient stock) still works.

const { test, expect } = require('@playwright/test');
const { createTestProduct, deleteTestProduct } = require('./helpers');

test.describe('Inventario — registrar movimiento', () => {
  let product;

  test.afterEach(async ({ request }) => {
    if (product?.id) await deleteTestProduct(request, product.id);
  });

  test('registrar una salida que cruza el umbral de stock mínimo responde 200 con el stock actualizado', async ({ request }) => {
    product = await createTestProduct(request, { stock_actual: 10, stock_minimo: 5 });

    const res = await request.post(`/api/inventario/${product.id}/movimiento`, {
      params: { cantidad: '6', tipo: 'SALIDA' },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.stock_actual).toBe(4); // 10 - 6 = 4 <= stock_minimo (5)
    expect(body.id).toBe(product.id);
  });

  test('registrar una entrada que no cruza el umbral responde 200 sin cambios de comportamiento', async ({ request }) => {
    product = await createTestProduct(request, { stock_actual: 10, stock_minimo: 5 });

    const res = await request.post(`/api/inventario/${product.id}/movimiento`, {
      params: { cantidad: '5', tipo: 'ENTRADA' },
    });

    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.stock_actual).toBe(15);
  });

  test('la validación de stock insuficiente sigue funcionando (no se rompió con el cambio)', async ({ request }) => {
    product = await createTestProduct(request, { stock_actual: 3, stock_minimo: 5 });

    const res = await request.post(`/api/inventario/${product.id}/movimiento`, {
      params: { cantidad: '10', tipo: 'SALIDA' },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/stock insuficiente/i);
  });
});
