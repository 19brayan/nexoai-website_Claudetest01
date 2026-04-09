# CLAUDE.md — Reglas del Equipo NexoAI

## Sobre la Empresa
Esta empresa se llama **NexoAI** y nos dedicamos a crear soluciones de software con inteligencia artificial.

## Reglas de Código

### Comentarios
- Todos los archivos de código deben tener comentarios en **español** explicando qué hace cada sección.

### Tecnologías Principales
- HTML
- CSS
- JavaScript

### Diseño Responsive
- El diseño siempre debe verse bien tanto en celular como en computadora.
- Usar media queries o enfoques mobile-first según corresponda.

### Colores de Marca
| Nombre       | Hex       |
|--------------|-----------|
| Azul oscuro  | `#1a1a2e` |
| Morado       | `#6C63FF` |
| Blanco       | `#ffffff` |

### Estructura de Páginas
Cada vez que se cree una página nueva debe incluir:
1. **Header** con el logo de NexoAI.
2. **Footer** con copyright: `© NexoAI. Todos los derechos reservados.`

## Flujo de Trabajo
Antes de crear cualquier archivo, explicar:
- **Qué** se va a crear.
- **Por qué** es necesario crearlo.

## Conexiones MCP

### GitHub
- Servidor: @modelcontextprotocol/server-github
- Configuración: .claude/mcp.json
- Token: almacenado en .env (NUNCA subir a GitHub)
- Permisos: lectura/escritura de repositorios
- Uso: Claude Code puede ver issues, crear branches, leer código directamente desde GitHub
