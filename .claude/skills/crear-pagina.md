# Skill: Crear Página Nueva para NexoAI

## Cuándo usar esta skill
Cuando el usuario pida crear una nueva página HTML para el sitio web de NexoAI.

## Reglas obligatorias

### Estructura HTML
- Toda página nueva va dentro de la carpeta `pages/`
- Nombre del archivo: descriptivo, minúsculas, separado por guiones: `nombre-seccion.html`
- Estructura HTML5 completa (DOCTYPE, html, head, body)
- Idioma: español (`lang="es"`)
- Meta viewport obligatorio para diseño responsive

### Estilos y colores
- Enlazar al CSS global: `../css/styles.css`
- Colores de la marca NexoAI:
  - Azul oscuro (fondo principal): #1a1a2e
  - Morado (acentos y botones): #6C63FF
  - Blanco (texto principal): #ffffff
- NO crear archivos CSS separados por página

### Header (copiar exacto de páginas existentes)
- Logo "NexoAI" a la izquierda
- Menú: Inicio, Servicios, Nosotros, Blog, Testimonios
- Menú hamburguesa para móviles
- Rutas relativas con `../` para archivos dentro de pages/

### Footer (copiar exacto de páginas existentes)
- Copyright: "© 2026 NexoAI - Todos los derechos reservados"
- Consistente en TODAS las páginas

### JavaScript
- Enlazar al JS global: `../js/main.js`
- JS específico de página va en `js/` con nombre descriptivo
- Menú hamburguesa ya está en main.js

### Código
- TODOS los comentarios en español
- Indentación: 2 espacios
- Nombres de clases CSS consistentes con lo existente

### Contenido
- Todo texto visible en español
- Contenido placeholder realista (no Lorem ipsum)
- Al menos una llamada a la acción (CTA) con botón morado

### Backend (si la página necesita enviar/recibir datos)
- El servidor Express corre en puerto 3001
- Las rutas API van en server.js
- Base de datos: SQLite en data/nexoai.db
- Autenticación: usuario admin con bcrypt

## Checklist antes de entregar
- [ ] Archivo en carpeta pages/
- [ ] Header y footer idénticos a las demás páginas
- [ ] Colores de marca respetados
- [ ] Responsive en móvil
- [ ] Comentarios en español
- [ ] Al menos un CTA con botón morado
- [ ] Si usa API: ruta documentada en server.js
