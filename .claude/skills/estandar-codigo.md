# Skill: Estándar de Código NexoAI

## Cuándo usar esta skill
En CUALQUIER modificación de código del proyecto NexoAI.

## Reglas de código

### General
- Comentarios en español siempre
- Indentación: 2 espacios (no tabs)
- Nombres de variables descriptivos en español o inglés consistente
- No dejar console.log de debug en código final

### Frontend (HTML/CSS/JS)
- HTML semántico (header, main, section, footer)
- CSS en archivo global styles.css
- JS en archivo global main.js o archivos específicos en js/
- Mobile-first: diseñar para móvil primero, luego escritorio
- Colores SOLO los de la marca (#1a1a2e, #6C63FF, #ffffff)

### Backend (Node.js/Express)
- Servidor en server.js
- Puerto: 3001
- Rutas API bajo /api/
- Respuestas JSON con estructura: { success: true/false, data/error }
- Manejo de errores con try/catch en cada ruta
- Base de datos SQLite en data/nexoai.db

### Git
- Una rama por funcionalidad: feature/nombre-descriptivo
- Commits descriptivos en español
- PR obligatorio antes de merge a main
- Hook pre-commit activo (no saltarse con --no-verify sin razón)

### Seguridad
- Credenciales en .env (nunca en código)
- .env en .gitignore
- Contraseñas hasheadas con bcrypt
- No exponer rutas admin sin autenticación
