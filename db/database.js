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
const bcrypt   = require('bcryptjs');        // Para encriptar y verificar contraseñas

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

// Crea la tabla "usuarios" para el sistema de autenticación
// Solo se crea si no existe, lo que hace seguro reiniciar el servidor
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT    NOT NULL UNIQUE,
    password_hash    TEXT    NOT NULL,
    nombre           TEXT    NOT NULL,
    rol              TEXT    NOT NULL DEFAULT 'admin',
    fecha_creacion   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

// Crea la tabla "suscripciones" para registrar los pagos completados via Stripe
db.exec(`
  CREATE TABLE IF NOT EXISTS suscripciones (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT    NOT NULL,
    plan              TEXT    NOT NULL,
    estado            TEXT    NOT NULL DEFAULT 'activo',
    stripe_session_id TEXT    NOT NULL,
    fecha_creacion    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
`);

// =============================================
// SEED AUTOMÁTICO DEL USUARIO ADMINISTRADOR
// Se ejecuta al arrancar el servidor.
// Si el usuario "admin" ya existe, no hace nada.
// Esto permite que Render configure todo solo en el
// primer arranque sin necesidad de correr seed.js manualmente.
// =============================================

const adminExistente = db.prepare(`
  SELECT id FROM usuarios WHERE username = 'admin'
`).get();

if (!adminExistente) {
  const password_hash = bcrypt.hashSync('nexoai2026', 10);
  db.prepare(`
    INSERT INTO usuarios (username, password_hash, nombre, rol)
    VALUES ('admin', ?, 'Administrador', 'admin')
  `).run(password_hash);
  console.log('[DB] Usuario admin creado automáticamente.');
}

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

/**
 * Cuenta cuántos mensajes fueron recibidos hoy (día actual).
 * Compara la fecha de cada mensaje con la fecha de hoy en formato local.
 * @returns {number} Cantidad de mensajes recibidos hoy
 */
function contarMensajesHoy() {
  const consulta = db.prepare(`
    SELECT COUNT(*) AS total FROM mensajes
    WHERE date(fecha) = date('now', 'localtime')
  `);
  return consulta.get().total;
}

/**
 * Devuelve el mensaje más reciente registrado en la base de datos.
 * Útil para mostrar en el dashboard del panel de administración.
 * @returns {object|undefined} El mensaje más reciente, o undefined si no hay ninguno
 */
function obtenerMensajeReciente() {
  const consulta = db.prepare(`
    SELECT * FROM mensajes
    ORDER BY id DESC
    LIMIT 1
  `);
  return consulta.get();
}

// =============================================
// FUNCIONES DE AUTENTICACIÓN
// Manejo de usuarios: registro, búsqueda y verificación
// =============================================

/**
 * Registra un nuevo usuario encriptando su contraseña antes de guardarla.
 * Nunca se guarda la contraseña en texto plano, solo el hash.
 * @param {string} username - Nombre de usuario único
 * @param {string} password - Contraseña en texto plano (se encripta aquí)
 * @param {string} nombre   - Nombre completo para mostrar
 * @param {string} rol      - Rol del usuario (por defecto: 'admin')
 * @returns {object} El usuario creado (sin el hash de contraseña)
 */
function registrarUsuario(username, password, nombre, rol = 'admin') {
  // Encripta la contraseña con un costo de 10 rondas de hashing
  // Cuanto mayor el número, más seguro pero más lento
  const password_hash = bcrypt.hashSync(password, 10);

  const insertar = db.prepare(`
    INSERT INTO usuarios (username, password_hash, nombre, rol)
    VALUES (@username, @password_hash, @nombre, @rol)
  `);

  const resultado = insertar.run({ username, password_hash, nombre, rol });

  // Devuelve el usuario sin el hash de contraseña por seguridad
  return buscarUsuarioPorUsername(username);
}

/**
 * Busca un usuario por su nombre de usuario.
 * Incluye el password_hash para poder verificarlo en el login.
 * @param {string} username - El nombre de usuario a buscar
 * @returns {object|undefined} El usuario encontrado, o undefined si no existe
 */
function buscarUsuarioPorUsername(username) {
  const consulta = db.prepare(`
    SELECT id, username, password_hash, nombre, rol, fecha_creacion
    FROM usuarios
    WHERE username = ?
  `);
  return consulta.get(username);
}

/**
 * Verifica si una contraseña en texto plano coincide con el hash guardado.
 * Usa bcrypt.compareSync para comparar de forma segura.
 * @param {string} password      - Contraseña en texto plano ingresada por el usuario
 * @param {string} password_hash - Hash guardado en la base de datos
 * @returns {boolean} true si la contraseña es correcta, false si no
 */
function verificarPassword(password, password_hash) {
  return bcrypt.compareSync(password, password_hash);
}

// =============================================
// FUNCIONES DE SUSCRIPCIONES
// Registra los pagos completados via Stripe
// =============================================

/**
 * Guarda una nueva suscripción tras un pago exitoso en Stripe.
 * @param {string} email             - Email del cliente que pagó
 * @param {string} plan              - Plan contratado: starter, pro o enterprise
 * @param {string} stripe_session_id - ID de la sesión de Stripe (checkout.session.id)
 * @returns {object} La suscripción recién creada
 */
function guardarSuscripcion(email, plan, stripe_session_id) {
  const insertar = db.prepare(`
    INSERT INTO suscripciones (email, plan, stripe_session_id)
    VALUES (@email, @plan, @stripe_session_id)
  `);
  const resultado = insertar.run({ email, plan, stripe_session_id });
  return db.prepare(`SELECT * FROM suscripciones WHERE id = ?`).get(resultado.lastInsertRowid);
}

// Exporta todas las funciones para que server.js pueda usarlas
module.exports = {
  guardarMensaje,
  obtenerMensajes,
  obtenerMensajePorId,
  eliminarMensaje,
  contarMensajes,
  contarMensajesHoy,
  obtenerMensajeReciente,
  registrarUsuario,
  buscarUsuarioPorUsername,
  verificarPassword,
  guardarSuscripcion
};
