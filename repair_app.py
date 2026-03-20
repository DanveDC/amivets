import os

path = r'c:\Users\dalec\Desktop\veterinaria\amivets\static\js\app.js'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Clean up any potential mangling at the end if it's there
# based on my previous observation, the mangling happens at the very end
# Let's find "const atenderOrden" and clean everything after it if needed.
# But better: just reconstruct the end part correctly.

new_lines = []
for line in lines:
    if 'atenderOrden = (citaId, mascotaId)Id;Id' in line:
        # Found the mangled line, stop here and we'll add the correct one
        break
    new_lines.append(line)

# Let's reconstruct the file using known good chunks
# Wait, I'll just use a more robust way: 
# Since the file is corrupted at the end, I'll use git checkout again and then apply the patch via Python.

os.system('git checkout static/js/app.js')

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Patches
patches = [
    (
        "const hoy = new Date().toISOString().split('T')[0];\n        const hoyCitas = citas.filter(c => c.fecha.startsWith(hoy));",
        "const hoy = new Date().toLocaleDateString('en-CA');\n        const safeCitas = Array.isArray(citas) ? citas : [];\n        const hoyCitas = safeCitas.filter(c => {\n            if (!c) return false;\n            const fecha = (c.fecha_cita || c.fecha || '').toString();\n            return fecha && typeof fecha.startsWith === 'function' && fecha.startsWith(hoy);\n        });"
    ),
    (
        "const today = new Date().toISOString().split('T')[0];\n        const citasHoy = citas.filter(c => c.fecha.startsWith(today)).length;",
        "const today = new Date().toLocaleDateString('en-CA');\n        const safeCitas = Array.isArray(citas) ? citas : [];\n        const citasHoy = safeCitas.filter(c => {\n            if (!c) return false;\n            const fecha = (c.fecha_cita || c.fecha || '').toString();\n            return fecha && typeof fecha.startsWith === 'function' && fecha.startsWith(today);\n        }).length;"
    ),
    (
        "document.getElementById('kpiCitas').textContent = citasHoy;\n        document.getElementById('kpiPacientes').textContent = citas.filter(c => c.estado === 'Finalizada').length;",
        "const kpiCitas = document.getElementById('kpiCitas');\n        if (kpiCitas) kpiCitas.textContent = citasHoy;\n        const kpiPacientes = document.getElementById('kpiPacientes');\n        if (kpiPacientes) kpiPacientes.textContent = safeCitas.filter(c => c && c.estado === 'Finalizada').length;"
    ),
    (
        "cargarBadgeOrdenes();\n});",
        "cargarBadgeOrdenes();\n    showSection('sec-consultorio');\n});"
    ),
    (
        "const misOrdenes = citas.filter(c => c.estado === 'pendiente');",
        "const safeCitas = Array.isArray(citas) ? citas : [];\n        const misOrdenes = safeCitas.filter(c => c && c.estado === 'pendiente');"
    )
]

for old, new in patches:
    content = content.replace(old, new)

# Add mostrarResumenDia
resumen_func = """
const mostrarResumenDia = (dateStr, allEvents) => {
    const resumenFecha = document.getElementById('resumenDiaFecha');
    const resumenCuerpo = document.getElementById('resumenDiaCuerpo');
    if (!resumenFecha || !resumenCuerpo) return;
    
    resumenFecha.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString();
    
    const safeAllEvents = Array.isArray(allEvents) ? allEvents : [];
    const eventosDia = safeAllEvents.filter(ev => ev && (ev.start || '').toString().startsWith(dateStr));
    
    if (eventosDia.length === 0) {
        resumenCuerpo.innerHTML = '<p style="text-align: center; color: #9ca3af; padding: 2rem;">No hubo actividad este día.</p>';
    } else {
        resumenCuerpo.innerHTML = eventosDia.map(ev => {
            const type = ev.extendedProps?.type;
            let icon = '📅';
            let color = '#4F46E5';
            let label = 'Cita';
            let detail = ev.extendedProps?.motivo || ev.extendedProps?.tipo || 'Sin motivo';

            if (type === 'consulta') { icon = '🩺'; color = '#10b981'; label = 'Consulta'; }
            if (type === 'cirugia') { icon = '🔪'; color = '#ef4444'; label = 'Cirugía'; detail = ev.extendedProps?.tipo_procedimiento; }
            if (type === 'prueba') { icon = '🧪'; color = '#8b5cf6'; label = 'Prueba/Lab'; detail = ev.extendedProps?.tipo; }

            return `
                <div style="padding: 1rem; border-bottom: 1px solid #f3f4f6; border-left: 4px solid ${color}; margin-bottom: 0.8rem; background: #f8fafc; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 700; color: ${color}; font-size: 0.9rem; text-transform: uppercase;">
                            ${icon} ${label}
                        </span>
                        <span style="font-size: 0.85rem; color: #6b7280;">
                            ${new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div style="margin-top: 0.5rem; font-size: 1.05rem; color: #1f2937; font-weight: 600;">
                        Paciente ID #${ev.extendedProps?.mascota_id}
                    </div>
                    <div style="font-size: 0.95rem; color: #4b5563; margin-top: 0.25rem;">
                        ${detail}
                    </div>
                </div>
            `;
        }).join('');
    }
    openModal('modalResumenDia');
};

"""

if 'const mostrarResumenDia' not in content:
    content = content.replace("const atenderOrden", resumen_func + "const atenderOrden")

with open(path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("Repair completed.")
