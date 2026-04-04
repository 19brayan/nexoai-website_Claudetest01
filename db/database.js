// =============================================
// DATABASE.JS — CAPA DE ACCESO A DATOS
// Maneja toda la interacción con la base de datos
// SQLite usando la librería better-sqlite3.
//
// Exporta funciones limpias para que server.js
// no tenga que escribir SQL directamente.
// =============================================

const Database = require('better-sqlite3'); // Librería SQLite síncrona para Node.js
const path     = require('path');            // Para construir rutas de archivo

// Ruta donde se guardará el archivo de base de datos SQLite
// __dirname apunta a la carpeta db/ donde está este archivo
const DB_PATH = path.join(__dirname, 'nexoai.db');

// Abre (o crea si no existe) la base de datos SQLite
// El archivo nexoai.db se genera automáticamente la primera vez
const db = new Database(DB_PATH);

// =============================================
// CONFIGURACIÓN INICIAL DE LA BASE DE DATOS
// Se ejecuta una sola vez al arrancar el servidor
// =============================================

// Activa WAL (Write-Ahead Logging) para mejor rendimiento
// en lecturas y escrituras concurrentes
db.pragma('journal_mode = WAL');

// Crea la tabla "mensajes" si aún no existe
// La sentencia es idempotente: no falla si ya existe
db.exec(`
  CREATE TABLE IF NOT EXISTS mensajes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre  TEXT    NOT NULL,
    email   TEXT    NOT NULL,
    mensaje TEXT    NOT NULL,
    fecha   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

// =============================================
// FUNCIONES EXPORTADAS
// Cada función representa una operación sobre
// la tabla "mensajes"
// =============================================

/**
 * Guarda un nuevo mensaje en la base de datos.
 * @param {string} nombre  - Nombre del remitente
 * @param {string} email   - Correo electrónico del remitente
 * @param {string} mensaje - Texto del mensaje
 * @returns {object} El mensaje recién insertado con su id y fecha
 */
function guardarMensaje(nombre, email, mensaje) {
  // Prepara la sentencia SQL una sola vez (más eficiente)
  const insertar = db.prepare(`
    INSERT INTO mensajes (nombre, email, mensaje)
    VALUES (@nombre, @email, @mensaje)
  `);

  // Ejecuta la inserción y obtiene el id generado
  const resultado = insertar.run({ nombre, email, mensaje });

  // Devuelve el registro completo recién insertado
  return obtenerMensajePorId(resultado.lastInsertRowid);
}

/**
 * Devuelve todos los mensajes ordenados del más reciente al más antiguo.
 * @returns {Array} Lista de todos los mensajes
 */
function obtenerMensajes() {
  const consulta = db.prepare(`
    SELECT * FROM mensajes
    ORDER BY id DESC
  `);
  return consulta.all();
}

/**
 * Busca y devuelve un mensaje por su id.
 * @param {number} id - El id del mensaje a buscar
 * @returns {object|undefined} El mensaje encontrado, o undefined si no existe
 */
function obtenerMensajePorId(id) {
  const consulta = db.prepare(`
    SELECT * FROM mensajes WHERE id = ?
  `);
  return consulta.get(id);
}

/**
 * Elimina un mensaje de la base de datos por su id.
 * @param {number} id - El id del mensaje a eliminar
 * @returns {boolean} true si se eliminó, false si no existía
 */
function eliminarMensaje(id) {
  const borrar = db.prepare(`
    DELETE FROM mensajes WHERE id = ?
  `);
  const resultado = borrar.run(id);

  // changes indica cuántas filas fueron afectadas
  return resultado.changes > 0;
}

/**
 * Devuelve el total de mensajes guardados en la base de datos.
 * @returns {number} Cantidad total de mensajes
 */
function contarMensajes() {
  const consulta = db.prepare(`
    SELECT COUNT(*) AS total FROM mensajes
  `);
  return consulta.get().total;
}

// Exporta todas las funciones para que server.js pueda usarlas
module.exports = {
  guardarMensaje,
  obtenerMensajes,
  obtenerMensajePorId,
  eliminarMensaje,
  contarMensajes
};
