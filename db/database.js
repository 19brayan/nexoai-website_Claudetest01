// =============================================
// DATABASE.JS — CAPA DE ACCESO A DATOS
// Soporta dos modos de conexión:
//   - Turso (nube): si existen TURSO_DATABASE_URL y TURSO_AUTH_TOKEN
//   - SQLite local (desarrollo): usando archivo db/nexoai.db
//
// Todas las funciones son async porque @libsql/client es asíncrono.
// =============================================

const { createClient } = require('@libsql/client'); // Cliente oficial de Turso / libSQL
const bcrypt           = require('bcryptjs');        // Para encriptar y verificar contraseñas
const path             = require('path');

// Determina el modo de conexión según las variables de entorno
const usaTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

// Crea el cliente según el entorno:
// - Producción (Turso): conexión remota autenticada
// - Desarrollo local: archivo SQLite en db/nexoai.db
const db = usaTurso
  ? createClient({
      url:       process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    })
  : createClient({
      url: `file:${path.join(__dirname, 'nexoai.db')}`
    });

console.log(`[DB] Modo: ${usaTurso ? 'Turso (nube)' : 'SQLite local'}`);

// =============================================
// INICIALIZACIÓN DE TABLAS
// Crea todas las tablas y el usuario admin si no existen.
// Se llama una vez al arrancar el servidor (await en server.js).
// =============================================

async function inicializarDB() {
  // WAL solo aplica a SQLite local; Turso maneja su propio journaling
  if (!usaTurso) {
    await db.execute('PRAGMA journal_mode = WAL');
  }

  // Tabla mensajes — incluye columna "origen" desde el inicio
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre  TEXT    NOT NULL,
      email   TEXT    NOT NULL,
      mensaje TEXT    NOT NULL,
      fecha   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      origen  TEXT    NOT NULL DEFAULT 'formulario'
    )
  `);

  // Agrega "origen" si la BD ya existía sin esa columna (backward compat)
  try {
    await db.execute(`ALTER TABLE mensajes ADD COLUMN origen TEXT NOT NULL DEFAULT 'formulario'`);
    console.log('[DB] Columna "origen" agregada a mensajes.');
  } catch {
    // La columna ya existe — ignorar el error
  }

  // Tabla usuarios para autenticación JWT
  await db.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      username       TEXT    NOT NULL UNIQUE,
      password_hash  TEXT    NOT NULL,
      nombre         TEXT    NOT NULL,
      rol            TEXT    NOT NULL DEFAULT 'admin',
      fecha_creacion TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Tabla suscripciones para registrar pagos de Stripe
  await db.execute(`
    CREATE TABLE IF NOT EXISTS suscripciones (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      email             TEXT    NOT NULL,
      plan              TEXT    NOT NULL,
      estado            TEXT    NOT NULL DEFAULT 'activo',
      stripe_session_id TEXT    NOT NULL,
      fecha_creacion    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Tabla clientes — usuarios registrados desde el portal o Stripe
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clientes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      email           TEXT    NOT NULL UNIQUE,
      password_hash   TEXT,
      nombre          TEXT    NOT NULL,
      plan            TEXT    NOT NULL DEFAULT 'starter',
      estado          TEXT    NOT NULL DEFAULT 'activo',
      fecha_registro  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Tabla conversaciones — historial acumulado por contacto (array JSON de sesiones)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS conversaciones (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      contacto_id    INTEGER NOT NULL,
      historial      TEXT    NOT NULL,
      tipo_agente    TEXT,
      fecha_creacion TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Agrega tipo_agente si la tabla ya existía sin esa columna (backward compat)
  try {
    await db.execute(`ALTER TABLE conversaciones ADD COLUMN tipo_agente TEXT`);
    console.log('[DB] Columna "tipo_agente" agregada a conversaciones.');
  } catch {
    // La columna ya existe — ignorar
  }

  // Seed automático del usuario administrador al primer arranque
  const adminResult = await db.execute(`SELECT id FROM usuarios WHERE username = 'admin'`);
  if (adminResult.rows.length === 0) {
    const password_hash = bcrypt.hashSync('nexoai2026', 10);
    await db.execute({
      sql:  `INSERT INTO usuarios (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)`,
      args: ['admin', password_hash, 'Administrador', 'admin']
    });
    console.log('[DB] Usuario admin creado automáticamente.');
  }
}

// =============================================
// FUNCIONES DE MENSAJES (CONTACTOS)
// =============================================

/**
 * Guarda un nuevo mensaje / contacto en la base de datos.
 * @param {string} nombre  - Nombre del remitente
 * @param {string} email   - Correo electrónico
 * @param {string} mensaje - Texto del mensaje
 * @param {string} origen  - "formulario" (por defecto) o "agente"
 * @returns {object} El registro recién insertado
 */
async function guardarMensaje(nombre, email, mensaje, origen = 'formulario') {
  const result = await db.execute({
    sql:  `INSERT INTO mensajes (nombre, email, mensaje, origen) VALUES (?, ?, ?, ?)`,
    args: [nombre, email, mensaje, origen]
  });
  return obtenerMensajePorId(Number(result.lastInsertRowid));
}

/**
 * Devuelve todos los mensajes ordenados del más reciente al más antiguo.
 */
async function obtenerMensajes() {
  const result = await db.execute(`SELECT * FROM mensajes ORDER BY id DESC`);
  return result.rows;
}

/**
 * Busca un mensaje por su id.
 */
async function obtenerMensajePorId(id) {
  const result = await db.execute({ sql: `SELECT * FROM mensajes WHERE id = ?`, args: [id] });
  return result.rows[0];
}

/**
 * Elimina un mensaje por su id.
 * @returns {boolean} true si se eliminó, false si no existía
 */
async function eliminarMensaje(id) {
  const result = await db.execute({ sql: `DELETE FROM mensajes WHERE id = ?`, args: [id] });
  return result.rowsAffected > 0;
}

/**
 * Devuelve el total de mensajes guardados.
 */
async function contarMensajes() {
  const result = await db.execute(`SELECT COUNT(*) AS total FROM mensajes`);
  return Number(result.rows[0].total);
}

/**
 * Cuenta mensajes recibidos hoy.
 */
async function contarMensajesHoy() {
  const result = await db.execute(
    `SELECT COUNT(*) AS total FROM mensajes WHERE date(fecha) = date('now', 'localtime')`
  );
  return Number(result.rows[0].total);
}

/**
 * Devuelve el mensaje más reciente.
 */
async function obtenerMensajeReciente() {
  const result = await db.execute(`SELECT * FROM mensajes ORDER BY id DESC LIMIT 1`);
  return result.rows[0];
}

/**
 * Busca si ya existe un contacto con ese email (para evitar duplicados del agente).
 * @param {string} email - Email a buscar
 * @returns {object|undefined} El registro encontrado, o undefined
 */
async function buscarContactoPorEmail(email) {
  const result = await db.execute({
    sql:  `SELECT * FROM mensajes WHERE email = ? ORDER BY id ASC LIMIT 1`,
    args: [email.trim().toLowerCase()]
  });
  return result.rows[0];
}

// =============================================
// FUNCIONES DE AUTENTICACIÓN
// =============================================

/**
 * Registra un nuevo usuario encriptando su contraseña.
 */
async function registrarUsuario(username, password, nombre, rol = 'admin') {
  const password_hash = bcrypt.hashSync(password, 10);
  await db.execute({
    sql:  `INSERT INTO usuarios (username, password_hash, nombre, rol) VALUES (?, ?, ?, ?)`,
    args: [username, password_hash, nombre, rol]
  });
  return buscarUsuarioPorUsername(username);
}

/**
 * Busca un usuario por su username. Incluye el hash para verificar login.
 */
async function buscarUsuarioPorUsername(username) {
  const result = await db.execute({
    sql:  `SELECT id, username, password_hash, nombre, rol, fecha_creacion FROM usuarios WHERE username = ?`,
    args: [username]
  });
  return result.rows[0];
}

/**
 * Verifica si una contraseña en texto plano coincide con el hash guardado.
 * Es síncrona porque bcrypt.compareSync no es una operación de BD.
 */
function verificarPassword(password, password_hash) {
  return bcrypt.compareSync(password, password_hash);
}

// =============================================
// FUNCIONES DE SUSCRIPCIONES
// =============================================

/**
 * Devuelve todas las suscripciones ordenadas por fecha descendente.
 */
async function obtenerSuscripciones() {
  const result = await db.execute(`SELECT * FROM suscripciones ORDER BY fecha_creacion DESC`);
  return result.rows;
}

/**
 * Guarda una suscripción tras un pago exitoso en Stripe.
 */
async function guardarSuscripcion(email, plan, stripe_session_id) {
  const result = await db.execute({
    sql:  `INSERT INTO suscripciones (email, plan, stripe_session_id) VALUES (?, ?, ?)`,
    args: [email, plan, stripe_session_id]
  });
  const row = await db.execute({
    sql:  `SELECT * FROM suscripciones WHERE id = ?`,
    args: [Number(result.lastInsertRowid)]
  });
  return row.rows[0];
}

// =============================================
// FUNCIONES DE CONVERSACIONES
// Acumula sesiones de chat del agente por contacto.
// El campo historial es un array JSON de sesiones:
//   [{ fecha: "2026-04-18", mensajes: [...] }, ...]
// =============================================

/**
 * Acumula una nueva sesión de conversación al historial del contacto.
 * Si ya existe un registro para ese contacto_id, agrega la sesión al array.
 * Si no existe, crea el registro con la primera sesión.
 * @param {number} contacto_id - Id del contacto en la tabla mensajes
 * @param {Array}  mensajes    - Turnos [{ role, content }] de esta sesión
 * @param {string} tipo_agente - "ventas", "soporte" o "faq"
 */
async function guardarConversacion(contacto_id, mensajes, tipo_agente = null) {
  const fecha = new Date().toISOString().slice(0, 10);
  const sesionNueva = { fecha, mensajes };

  const existente = await db.execute({
    sql:  `SELECT * FROM conversaciones WHERE contacto_id = ? LIMIT 1`,
    args: [contacto_id]
  });

  if (existente.rows.length > 0) {
    // Agrega la sesión nueva al array acumulado sin sobreescribir las anteriores
    const sesiones = JSON.parse(existente.rows[0].historial);
    sesiones.push(sesionNueva);
    await db.execute({
      sql:  `UPDATE conversaciones SET historial = ?, tipo_agente = ? WHERE contacto_id = ?`,
      args: [JSON.stringify(sesiones), tipo_agente, contacto_id]
    });
  } else {
    // Primera conversación para este contacto
    await db.execute({
      sql:  `INSERT INTO conversaciones (contacto_id, historial, tipo_agente) VALUES (?, ?, ?)`,
      args: [contacto_id, JSON.stringify([sesionNueva]), tipo_agente]
    });
  }
}

/**
 * Devuelve métricas generales del negocio:
 * - total_conversaciones: total de registros en la tabla conversaciones
 * - leads_agente: contactos captados por el agente de IA
 * - suscriptores_activos: suscripciones con estado "activo"
 * - por_agente: desglose de conversaciones por tipo de agente
 * - tasa_conversion: porcentaje de leads que se convirtieron en suscriptores
 */
async function obtenerAnalytics() {
  const [convResult, leadsResult, suscResult, porAgenteResult] = await Promise.all([
    db.execute(`SELECT COUNT(*) AS total FROM conversaciones`),
    db.execute(`SELECT COUNT(*) AS total FROM mensajes WHERE origen = 'agente'`),
    db.execute(`SELECT COUNT(*) AS total FROM suscripciones WHERE estado = 'activo'`),
    db.execute(`
      SELECT tipo_agente, COUNT(*) AS total
      FROM conversaciones
      WHERE tipo_agente IS NOT NULL
      GROUP BY tipo_agente
    `)
  ]);

  const total_conversaciones = Number(convResult.rows[0].total);
  const leads_agente         = Number(leadsResult.rows[0].total);
  const suscriptores_activos = Number(suscResult.rows[0].total);

  // Construye el desglose por agente con valores por defecto en 0
  const por_agente = { ventas: 0, soporte: 0, faq: 0 };
  for (const fila of porAgenteResult.rows) {
    if (fila.tipo_agente in por_agente) {
      por_agente[fila.tipo_agente] = Number(fila.total);
    }
  }

  // Tasa de conversión: suscriptores / leads × 100 (0 si no hay leads)
  const tasa_conversion = leads_agente > 0
    ? Math.round((suscriptores_activos / leads_agente) * 100)
    : 0;

  return { total_conversaciones, leads_agente, suscriptores_activos, por_agente, tasa_conversion };
}

// =============================================
// FUNCIONES DE CLIENTES
// Gestión de usuarios del portal (clientes finales, no admins)
// =============================================

/**
 * Crea un nuevo cliente. password_hash puede ser null si el registro
 * viene de Stripe (aún no tiene contraseña definida).
 */
async function crearUsuario(email, password_hash, nombre, plan = 'starter') {
  const result = await db.execute({
    sql:  `INSERT INTO clientes (email, password_hash, nombre, plan) VALUES (?, ?, ?, ?)`,
    args: [email.trim().toLowerCase(), password_hash, nombre, plan]
  });
  return buscarUsuarioPorId(Number(result.lastInsertRowid));
}

/**
 * Busca un cliente por su email.
 * @returns {object|undefined}
 */
async function buscarUsuarioPorEmail(email) {
  const result = await db.execute({
    sql:  `SELECT * FROM clientes WHERE email = ?`,
    args: [email.trim().toLowerCase()]
  });
  return result.rows[0];
}

/**
 * Busca un cliente por su id.
 * @returns {object|undefined}
 */
async function buscarUsuarioPorId(id) {
  const result = await db.execute({
    sql:  `SELECT * FROM clientes WHERE id = ?`,
    args: [id]
  });
  return result.rows[0];
}

/**
 * Actualiza el plan de un cliente por email.
 * Si el cliente no existe, lo crea con los datos mínimos disponibles.
 * @returns {object} El cliente actualizado
 */
async function actualizarPlanUsuario(email, plan) {
  const emailNorm = email.trim().toLowerCase();
  const existente = await buscarUsuarioPorEmail(emailNorm);

  if (existente) {
    await db.execute({
      sql:  `UPDATE clientes SET plan = ?, estado = 'activo' WHERE email = ?`,
      args: [plan, emailNorm]
    });
    return buscarUsuarioPorEmail(emailNorm);
  } else {
    // Cliente aún no registrado en el portal — lo crea con datos mínimos de Stripe
    return crearUsuario(emailNorm, null, emailNorm, plan);
  }
}

/**
 * Devuelve el array de sesiones acumuladas de un contacto.
 * @param {number} contacto_id
 * @returns {Array} [{ fecha, mensajes }] o [] si no existe
 */
async function obtenerConversaciones(contacto_id) {
  const result = await db.execute({
    sql:  `SELECT historial FROM conversaciones WHERE contacto_id = ? LIMIT 1`,
    args: [contacto_id]
  });
  return result.rows.length > 0 ? JSON.parse(result.rows[0].historial) : [];
}

// Exporta todas las funciones para que server.js pueda usarlas
module.exports = {
  inicializarDB,
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
  guardarSuscripcion,
  obtenerSuscripciones,
  buscarContactoPorEmail,
  guardarConversacion,
  obtenerConversaciones,
  obtenerAnalytics,
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  actualizarPlanUsuario
};
