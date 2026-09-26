# Spec Delta

## Purpose

La pantalla del encargado de área es su único espacio de trabajo: muestra su rubro, los servicios que le toca hacer, lo que ya hizo con sus resultados y lo que gana por comisión, sin acceso al padrón completo de la clínica.

## ADDED Requirements

### Requirement: Sin búsqueda global para el encargado

The system SHALL NOT offer the global search to a user with role `gestor`: the header search button MUST NOT be visible, and the search palette MUST NOT open through the button, the keyboard shortcut or any other entry point. Other roles SHALL keep the global search.

#### Scenario: El buscador no se ve
- **WHEN** un gestor inicia sesión
- **THEN** el botón "Buscar mascota o tutor" de la cabecera no está visible

#### Scenario: La búsqueda no se abre
- **WHEN** un gestor pulsa Ctrl/Cmd+K o se intenta abrir la paleta de búsqueda
- **THEN** la paleta de búsqueda no se abre

#### Scenario: Otros roles conservan la búsqueda
- **WHEN** un admin, recepcionista o veterinario inicia sesión
- **THEN** el botón de búsqueda está visible y abre la paleta

### Requirement: Rubro del encargado

The system SHALL expose `GET /api/areas/mias`, returning to any authenticated user the active areas they manage (id and name), and SHALL include `area_id` in every service response. The encargado's screen SHALL show the names of their areas in its header and SHALL offer one filter per area of theirs, even when there are no pending services.

#### Scenario: Ver su rubro
- **WHEN** un gestor de las áreas "Laboratorio" y "Estética" abre su pantalla
- **THEN** la cabecera muestra "Laboratorio" y "Estética", y hay un filtro por cada una

#### Scenario: Rubro con bandeja vacía
- **WHEN** un gestor sin servicios pendientes abre su pantalla
- **THEN** igual ve el nombre de su área y el mensaje de que no hay nada pendiente

#### Scenario: Sin áreas asignadas
- **WHEN** un gestor que no está asignado a ningún área abre su pantalla
- **THEN** ve un aviso de que todavía no tiene un área asignada

#### Scenario: Áreas de otro
- **WHEN** un gestor consulta `GET /api/areas/mias`
- **THEN** recibe solo las áreas activas de las que es gestor, no las de otras personas

### Requirement: Historial de lo realizado

The system SHALL expose `GET /api/servicios/realizados?desde=&hasta=&area_id=` to `gestor` and `veterinario`, returning the non-deleted services the current user took and executed (state `EJECUTADO`) within the execution date range, newest first, each with service name, area name, patient name, order number, execution date and number of attachments. The encargado's screen SHALL show these in a "Realizados" view with a date range, where each service lets the user see and download its attachments.

#### Scenario: Ver lo realizado
- **WHEN** un gestor ejecutó dos servicios hoy y consulta sus realizados de hoy
- **THEN** ve los dos, del más reciente al más antiguo, con área, paciente, orden y cantidad de adjuntos

#### Scenario: Solo lo propio
- **WHEN** otro gestor del mismo área ejecutó un servicio
- **THEN** ese servicio no aparece en los realizados del primer gestor

#### Scenario: Volver a ver un resultado
- **WHEN** el gestor abre un servicio realizado que tiene un adjunto
- **THEN** puede descargar ese adjunto

#### Scenario: Filtrar por rango y área
- **WHEN** el gestor elige un rango de fechas o una de sus áreas
- **THEN** la lista muestra solo los servicios ejecutados en ese rango o en esa área

### Requirement: Mis comisiones en la pantalla del encargado

The encargado's screen SHALL offer, to `gestor` and `veterinario`, a "Mis comisiones" view with the user's own pending and liquidated commission lines for a date range and their totals, and the list of the user's liquidations with a button to download each receipt PDF. It MUST NOT show other people's commissions.

#### Scenario: Ver mis comisiones
- **WHEN** un gestor con un servicio cobrado al 40% abre "Mis comisiones" del mes
- **THEN** ve la línea pendiente con su monto y el total que le corresponde

#### Scenario: Descargar mi comprobante
- **WHEN** el gestor tiene una liquidación y pulsa "Descargar PDF"
- **THEN** se descarga el comprobante de esa liquidación

### Requirement: Textos seguros en la pantalla del encargado

The encargado's screen MUST escape every text that comes from the server (area, service, patient, order and file names) before inserting it into the page.

#### Scenario: Nombre con HTML
- **WHEN** un servicio de la bandeja se llama `<img src=x onerror=alert(1)>`
- **THEN** la pantalla muestra ese texto literal y no ejecuta nada
