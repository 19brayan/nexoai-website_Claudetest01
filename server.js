// =============================================
// SERVIDOR PRINCIPAL DE NEXOAI
// Levanta un servidor Express que:
//   1. Sirve el sitio web estático (HTML, CSS, JS)
//   2. Expone una API REST para el formulario de contacto
// =============================================

const express = require('express'); // Framework para crear el servidor web
const fs      = require('fs');      // Módulo nativo de Node para leer/escribir archivos
const path    = require('path');    // Módulo nativo para construir rutas de archivos

// Inicialización de la aplicación Express
const app  = express();
const PORT = 3001; // Puerto donde correrá el servidor

// Ruta al archivo JSON que almacena los mensajes de contacto
const ARCHIVO_MENSAJES = path.join(__dirname, 'data', 'mensajes.json');

// =============================================
// MIDDLEWARE
// Configuración global que se aplica a todas las rutas
// =============================================

// Permite que Express entienda el cuerpo de peticiones en formato JSON
app.use(express.json());

// Sirve todos los archivos estáticos del proyecto (HTML, CSS, JS, imágenes)
// desde la carpeta raíz del proyecto
app.use(express.static(__dirname));

// =============================================
// FUNCIONES AUXILIARES
// Helpers para leer y escribir el archivo JSON
// =============================================

/**
 * Lee el archivo mensajes.json y devuelve el array de mensajes.
 * Si el archivo no existe o está vacío, devuelve un array vacío.
 */
function leerMensajes() {
  try {
    const contenido = fs.readFileSync(ARCHIVO_MENSAJES, 'utf-8');
    return JSON.parse(contenido);
  } catch {
    return [];
  }
}

/**
 * Recibe un array de mensajes y lo guarda en mensajes.json
 * con formato legible (indentado con 2 espacios).
 */
function guardarMensajes(mensajes) {
  fs.writeFileSync(ARCHIVO_MENSAJES, JSON.stringify(mensajes, null, 2), 'utf-8');
}

// =============================================
// RUTAS DE LA API
// Endpoints que el frontend puede llamar via fetch
// =============================================

/**
 * POST /api/contacto
 * Recibe: { nombre, email, mensaje } en el cuerpo de la petición
 * Guarda el mensaje en mensajes.json con fecha y hora
 * Responde con éxito o error
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

  // Construye el objeto del nuevo mensaje con timestamp
  const nuevoMensaje = {
    id:        Date.now(),               // ID único basado en timestamp
    nombre:    nombre.trim(),
    email:     email.trim().toLowerCase(),
    mensaje:   mensaje.trim(),
    fecha:     new Date().toISOString()  // Fecha en formato estándar ISO
  };

  // Lee los mensajes existentes, agrega el nuevo y guarda
  const mensajes = leerMensajes();
  mensajes.push(nuevoMensaje);
  guardarMensajes(mensajes);

  console.log(`[API] Nuevo mensaje de ${nuevoMensaje.nombre} (${nuevoMensaje.email})`);

  // Responde con éxito
  res.status(201).json({
    exito:   true,
    mensaje: '¡Mensaje recibido! Te responderemos pronto.',
    datos:   nuevoMensaje
  });
});

/**
 * GET /api/contacto
 * Devuelve todos los mensajes guardados en mensajes.json
 * ordenados del más reciente al más antiguo
 */
app.get('/api/contacto', (_req, res) => {
  const mensajes = leerMensajes();

  // Ordena del más reciente al más antiguo por ID (timestamp)
  const ordenados = mensajes.sort((a, b) => b.id - a.id);

  res.json({
    exito:   true,
    total:   ordenados.length,
    datos:   ordenados
  });
});

// =============================================
// INICIO DEL SERVIDOR
// Escucha en el puerto definido y muestra un mensaje en consola
// =============================================
app.listen(PORT, () => {
  console.log(`✓ Servidor NexoAI corriendo en http://localhost:${PORT}`);
  console.log(`✓ API disponible en http://localhost:${PORT}/api/contacto`);
});
