-- ============================================================
-- AMIVETS — Supabase Setup SQL
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. TABLA DE VETERINARIOS
--    Registra los médicos disponibles para agendar citas.
--    Poblarla manualmente con los vets de tu clínica.
-- ------------------------------------------------------------
create table if not exists veterinarios (
  id                  serial primary key,
  nombre              text not null,
  especialidad        text,
  amivets_usuario_id  integer,   -- ID en la tabla "usuarios" del Amivets local
  activo              boolean default true,
  created_at          timestamptz default now()
);

-- Ejemplo de datos (ajusta según tus vets reales):
insert into veterinarios (nombre, especialidad, amivets_usuario_id) values
  ('Dr. García',   'Medicina General',  1),
  ('Dra. Martínez','Cirugía',           2),
  ('Dr. López',    'Dermatología',      3)
on conflict do nothing;

-- 2. TABLA DE HORARIOS POR VETERINARIO
--    Define los bloques de disponibilidad semanal de cada vet.
-- ------------------------------------------------------------
create table if not exists horarios_veterinarios (
  id                  serial primary key,
  veterinario_id      integer not null references veterinarios(id) on delete cascade,
  dia_semana          integer not null check (dia_semana between 0 and 6),
                      -- 0 = Lunes, 1 = Martes, ..., 6 = Domingo
  hora_inicio         time not null,
  hora_fin            time not null,
  duracion_consulta_minutos    integer default 30,
  activo              boolean default true
);

-- Ejemplo: todos los vets trabajan Lun–Vie 08:00–17:00 en bloques de 30 min
insert into horarios_veterinarios (veterinario_id, dia_semana, hora_inicio, hora_fin, duracion_consulta_minutos)
select v.id, d.dia, '08:00'::time, '17:00'::time, 30
from   veterinarios v
cross join (values (0),(1),(2),(3),(4)) as d(dia)
on conflict do nothing;

-- 3. TABLA DE CITAS AGENDADAS (puente Supabase ↔ Amivets)
--    El formulario público escribe aquí; el worker las consume.
-- ------------------------------------------------------------
create table if not exists citas_agendadas (
  id                uuid primary key default gen_random_uuid(),

  -- Datos del cliente (capturados en el formulario)
  nombre_cliente    text not null,
  telefono          text not null,
  nombre_mascota    text not null,
  tipo_mascota      text not null,   -- Perro, Gato, Ave, etc.

  -- Datos de la cita
  veterinario_id    integer references veterinarios(id),
  fecha_cita        date not null,
  hora_cita         time not null,

  -- Control de sincronización
  estado            text not null default 'pendiente',
                    -- pendiente | sincronizada | rechazada
  amivets_cita_id   integer,         -- ID asignado tras sincronizar
  error_msg         text,            -- mensaje si falla la sincronización
  created_at        timestamptz default now(),
  sincronizada_at   timestamptz
);

-- Índice para que el worker pueda filtrar rápido
create index if not exists idx_citas_agendadas_estado
  on citas_agendadas (estado)
  where estado = 'pendiente';

-- 4. ROW LEVEL SECURITY (RLS)
--    - veterinarios y horarios: solo lectura pública (el form los consulta)
--    - citas_agendadas: insert público + update solo desde service role (el worker)
-- ------------------------------------------------------------
alter table veterinarios        enable row level security;
alter table horarios_veterinarios enable row level security;
alter table citas_agendadas     enable row level security;

-- veterinarios: lectura pública
create policy "public_read_veterinarios"
  on veterinarios for select using (activo = true);

-- horarios: lectura pública
create policy "public_read_horarios"
  on horarios_veterinarios for select using (activo = true);

-- citas_agendadas: INSERT público (el cliente manda su cita)
create policy "public_insert_citas"
  on citas_agendadas for insert with check (true);

-- citas_agendadas: SELECT y UPDATE solo para service role (el worker usa la secret key)
-- (service role bypasses RLS por defecto, así que no hace falta policy adicional)
