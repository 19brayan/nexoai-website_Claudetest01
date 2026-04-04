// =============================================
// SERVIDOR PRINCIPAL DE NEXOAI
// Levanta un servidor Express que:
//   1. Sirve el sitio web estático (HTML, CSS, JS)
//   2. Expone una API REST para el formulario de contacto
//   3. Almacena los mensajes en una base de datos SQLite
// =============================================

const express = require('express'); // Framework para crear el servidor web

// Importa las funciones de acceso a la base de datos SQLite
const {
  guardarMensaje,
  obtenerMensajes,
  eliminarMensaje,
  contarMensajes
} = require('./db/database');

// Inicialización de la aplicación Express
const app  = express();
const PORT = 3001; // Puerto donde correrá el servidor

// =============================================
// MIDDLEWARE
// Configuración global que se aplica a todas las rutas
// =============================================

// Permite que Express entienda el cuerpo de peticiones en formato JSON
app.use(express.json());

// Sirve todos los archivos estáticos del proyecto (HTML, CSS, JS)
// desde la carpeta raíz del proyecto
app.use(express.static(__dirname));

// =============================================
// RUTAS DE LA API
// Endpoints que el frontend puede llamar via fetch
// =============================================

/**
 * POST /api/contacto
 * Recibe: { nombre, email, mensaje } en el cuerpo de la petición
 * Guarda el mensaje en la base de datos SQLite
 * Responde con el mensaje guardado o un error de validación
 */
app.post('/api/contacto', (req, res) => {
  const { nombre, email, mensaje } = req.body;

  // Validación: los tres campos son obligatorios
  if (!nombre || !email || !mensaje) {
    return res.status(400).json({
      exito: false,
      error: 'Todos los campos son obligatorios: nombre, email y mensaje.'
    });
  }

  // Guarda el mensaje en SQLite y obtiene el registro completo
  const nuevoMensaje = guardarMensaje(
    nombre.trim(),
    email.trim().toLowerCase(),
    mensaje.trim()
  );

  console.log(`[API] Nuevo mensaje de ${nuevoMensaje.nombre} (${nuevoMensaje.email})`);

  // Responde con el mensaje guardado
  res.status(201).json({
    exito:   true,
    mensaje: '¡Mensaje recibido! Te responderemos pronto.',
    datos:   nuevoMensaje
  });
});

/**
 * GET /api/contacto
 * Devuelve todos los mensajes guardados en la base de datos
 * ordenados del más reciente al más antiguo
 */
app.get('/api/contacto', (_req, res) => {
  const mensajes = obtenerMensajes();

  res.json({
    exito: true,
    total: mensajes.length,
    datos: mensajes
  });
});

/**
 * GET /api/contacto/count
 * Devuelve únicamente el conteo total de mensajes
 * Útil para mostrar estadísticas en un panel de administración
 */
app.get('/api/contacto/count', (_req, res) => {
  const total = contarMensajes();

  res.json({
    exito: true,
    total
  });
});

/**
 * DELETE /api/contacto/:id
 * Elimina un mensaje de la base de datos por su id
 * :id es un parámetro dinámico en la URL (ej: /api/contacto/5)
 */
app.delete('/api/contacto/:id', (req, res) => {
  // Convierte el id de string a número entero
  const id = parseInt(req.params.id, 10);

  // Valida que el id sea un número válido
  if (isNaN(id)) {
    return res.status(400).json({
      exito: false,
      error: 'El id debe ser un número válido.'
    });
  }

  // Intenta eliminar el mensaje y verifica si existía
  const eliminado = eliminarMensaje(id);

  if (!eliminado) {
    return res.status(404).json({
      exito: false,
      error: `No se encontró ningún mensaje con id ${id}.`
    });
  }

  console.log(`[API] Mensaje con id ${id} eliminado.`);

  res.json({
    exito:   true,
    mensaje: `Mensaje con id ${id} eliminado correctamente.`
  });
});

// =============================================
// INICIO DEL SERVIDOR
// Escucha en el puerto definido y muestra un mensaje en consola
// =============================================
app.listen(PORT, () => {
  console.log(`✓ Servidor NexoAI corriendo en http://localhost:${PORT}`);
  console.log(`✓ API disponible en http://localhost:${PORT}/api/contacto`);
  console.log(`✓ Base de datos SQLite: db/nexoai.db`);
});
