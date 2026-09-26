// @ts-check
// Crear un propietario lleva directo al alta de su mascota (propietario-a-mascota).
const { test, expect } = require('@playwright/test');
const { ADMIN_CREDENTIALS, getAdminToken, authHeaders, testTag } = require('./helpers');

test('crear un propietario abre el alta de mascota con él elegido y la mascota queda asociada', async ({ page, request }) => {
  const admin = await getAdminToken(request);
  await page.goto('/login');
  await page.fill('#username', ADMIN_CREDENTIALS.username);
  await page.fill('#password', ADMIN_CREDENTIALS.password);
  await page.click('#btnLogin');
  await page.waitForURL('**/');

  const nombre = testTag('tutor');
  const cedula = `${Date.now()}`.slice(-10);
  await page.locator('#avNewMenu > summary').click();
  await page.click('#btnRegistrarPropietario');
  await expect(page.locator('#modalPropietario')).toBeVisible();
  await page.fill('#propietarioNombre', nombre);
  await page.fill('#propietarioApellido', 'Prueba');
  await page.fill('#propietarioCedula', cedula);
  await page.fill('#propietarioTelefono', '04141234567');
  await page.locator('#formPropietario button[type="submit"]').click();

  // Se abre el alta de mascota con el propietario nuevo ya elegido.
  await expect(page.locator('#modalMascota')).toBeVisible({ timeout: 10000 });
  const [prop] = (await (await request.get(`/api/propietarios/?search=${encodeURIComponent(nombre)}`, { headers: authHeaders(admin) })).json());
  await expect(page.locator('#mascotaPropietarioId')).toHaveValue(String(prop.id));

  const mascotaNombre = testTag('pet');
  await page.fill('#mascotaNombre', mascotaNombre);
  await page.selectOption('#mascotaEspecie', 'Perro');
  await page.selectOption('#mascotaSexo', 'Macho');
  await page.locator('#formMascota button[type="submit"]').click();
  await expect(page.locator('#modalMascota')).toBeHidden({ timeout: 10000 });
  const mascotas = await (await request.get(`/api/mascotas/?propietario_id=${prop.id}`, { headers: authHeaders(admin) })).json();
  // El API muestra el nombre de la mascota con el apellido del tutor.
  expect(mascotas.some((m) => m.nombre.startsWith(mascotaNombre))).toBe(true);
});
