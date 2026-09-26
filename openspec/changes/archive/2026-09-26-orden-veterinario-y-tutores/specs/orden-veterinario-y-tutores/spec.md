# Spec Delta

## Purpose

Abrir una orden asignándole un veterinario que la vea en su panel, mostrar el veterinario de cada orden, navegar propietarios y todas sus mascotas, y poder reiniciar los datos iniciales en cualquier instalación.

## ADDED Requirements

### Requirement: Asignar veterinario al abrir una orden

After choosing the patient, the "Nueva orden" flow SHALL ask for the veterinarian (required for admin and recepcionista; a veterinarian opening an order is assigned by default) and an optional reason, and SHALL create the order with that `veterinario_id`. The order screen SHALL allow changing the assigned veterinarian.

#### Scenario: Admin abre una orden para un veterinario
- **WHEN** el admin elige un paciente, elige a un veterinario y confirma
- **THEN** se crea la orden con ese veterinario y aparece en el Panel del día de ese veterinario

#### Scenario: Sin veterinario no se abre
- **WHEN** el admin intenta confirmar sin elegir veterinario
- **THEN** la pantalla pide elegirlo y no crea la orden

#### Scenario: Cambiar el veterinario de la orden
- **WHEN** en la pantalla de la orden se elige otro veterinario
- **THEN** la orden queda asignada al nuevo veterinario

### Requirement: Veterinario en el Panel del día

The Panel del día orders table SHALL include a "Veterinario" column with the assigned veterinarian's name, or "Sin asignar".

#### Scenario: Ver el veterinario de cada orden
- **WHEN** el admin abre el Panel del día
- **THEN** cada orden muestra el nombre de su veterinario o "Sin asignar"

### Requirement: Secciones Mascotas y Propietarios

The Mascotas/Tutores module SHALL offer "Mascotas" and "Propietarios" as separate menu entries.

#### Scenario: Entrar a Propietarios desde el menú
- **WHEN** un admin o recepcionista abre el módulo Mascotas/Tutores
- **THEN** la barra lateral tiene una entrada "Propietarios" que abre el listado de propietarios

### Requirement: Todas las mascotas de un tutor

Choosing an owner from the Propietarios list or from the global search SHALL show all of that owner's pets. Owner pickers (new pet, pet transfer) SHALL list every active owner, not only the first 100.

#### Scenario: Tutor con varias mascotas desde la búsqueda global
- **WHEN** el usuario busca un tutor con 8 mascotas y lo elige en la búsqueda global
- **THEN** ve las 8 mascotas del tutor

#### Scenario: Selector de propietario completo
- **WHEN** el usuario abre el alta de mascota
- **THEN** el selector de propietario ofrece todos los propietarios activos

### Requirement: Reiniciar datos iniciales

The project SHALL provide a documented script that resets a local installation to the initial data (admin, real registry of veterinarians, owners and pets, and service catalog), using the real-data SQL file placed manually on that machine, which MUST NOT be committed to the repository.

#### Scenario: Reinicio en otra máquina
- **WHEN** en otra instalación se copia el archivo de datos reales y se corre el script de reinicio
- **THEN** la base queda con el admin, el padrón real y el catálogo, sin órdenes ni facturas
