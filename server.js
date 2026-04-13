// =============================================
// SERVIDOR PRINCIPAL DE NEXOAI
// Levanta un servidor Express que:
//   1. Sirve el sitio web estático (HTML, CSS, JS)
//   2. Expone una API REST para el formulario de contacto
//   3. Almacena los mensajes en una base de datos SQLite
// =============================================

require('dotenv').config(); // Carga las variables del .env
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const express = require('express'); // Framework para crear el servidor web
const jwt     = require('jsonwebtoken'); // Para crear y verificar tokens JWT

// Importa las funciones de acceso a la base de datos SQLite
const {
  guardarMensaje,
  obtenerMensajes,
  eliminarMensaje,
  contarMensajes,
  contarMensajesHoy,
  obtenerMensajeReciente,
  buscarUsuarioPorUsername,
  verificarPassword,
  guardarSuscripcion
} = require('./db/database');

// Clave secreta para firmar los tokens JWT
// En producción esto debe estar en una variable de entorno (.env)
const JWT_SECRET = 'nexoai_secret_2026';

// Inicialización de la aplicación Express
const app  = express();
// En Render, el puerto lo asigna la plataforma via variable de entorno PORT.
// Si no existe (entorno local), usamos 3001 como respaldo.
const PORT = process.env.PORT || 3001;

// =============================================
// MIDDLEWARE
// Configuración global que se aplica a todas las rutas
// =============================================

// =============================================
// WEBHOOK DE STRIPE
// Debe ir ANTES de express.json() porque Stripe
// requiere el body en formato raw (sin parsear)
// para poder verificar la firma del evento.
// =============================================

app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const firma = req.headers['stripe-signature'];

  let evento;
  try {
    // Verifica que el evento venga realmente de Stripe usando la firma
    evento = stripe.webhooks.constructEvent(
      req.body,
      firma,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Firma de webhook inválida:', error.message);
    return res.status(400).json({ error: 'Firma inválida' });
  }

  // Procesa el evento según su tipo
  if (evento.type === 'checkout.session.completed') {
    const sesion = evento.data.object;
    const email  = sesion.customer_details?.email || 'desconocido';
    const plan   = sesion.metadata?.plan || 'desconocido';

    // Guarda la suscripción en la base de datos
    guardarSuscripcion(email, plan, sesion.id);
    console.log(`✅ Pago exitoso: ${email} — Plan: ${plan}`);
  }

  res.status(200).json({ received: true });
});

// Permite que Express entienda el cuerpo de peticiones en formato JSON
app.use(express.json());

// Sirve todos los archivos estáticos del proyecto (HTML, CSS, JS)
// desde la carpeta raíz del proyecto
app.use(express.static(__dirname));

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN
// Verifica que el token JWT sea válido antes de
// permitir acceso a rutas protegidas
// =============================================

/**
 * Middleware que verifica el token JWT en el header Authorization.
 * Si el token es válido, agrega el usuario a req.usuario y continúa.
 * Si no, responde con error 401 (No autorizado).
 */
function verificarToken(req, res, next) {
  // El token viene en el header: "Authorization: Bearer <token>"
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];

  // Si no hay token, rechaza la petición
  if (!token) {
    return res.status(401).json({
      exito: false,
      error: 'Acceso no autorizado. Se requiere token de sesión.'
    });
  }

  // Verifica que el token sea válido y no haya expirado
  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) {
      return res.status(401).json({
        exito: false,
        error: 'Token inválido o expirado. Inicia sesión nuevamente.'
      });
    }

    // Guarda los datos del usuario en la petición para usarlos en la ruta
    req.usuario = usuario;
    next(); // Pasa al siguiente middleware o ruta
  });
}

// =============================================
// RUTAS DE AUTENTICACIÓN
// Login y verificación de token JWT
// =============================================

/**
 * POST /api/auth/login
 * Recibe: { username, password }
 * Verifica las credenciales y devuelve un token JWT si son correctas
 */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  // Validación básica de campos
  if (!username || !password) {
    return res.status(400).json({
      exito: false,
      error: 'El usuario y la contraseña son obligatorios.'
    });
  }

  // Busca el usuario en la base de datos
  const usuario = buscarUsuarioPorUsername(username.trim());

  // Si no existe el usuario o la contraseña es incorrecta, mismo error
  // (no revelar cuál de los dos falló por seguridad)
  if (!usuario || !verificarPassword(password, usuario.password_hash)) {
    return res.status(401).json({
      exito: false,
      error: 'Usuario o contraseña incorrectos.'
    });
  }

  // Genera un token JWT con los datos del usuario
  // El token expira en 8 horas (tiempo de una jornada laboral)
  const token = jwt.sign(
    {
      id:       usuario.id,
      username: usuario.username,
      nombre:   usuario.nombre,
      rol:      usuario.rol
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[AUTH] Login exitoso: ${usuario.username}`);

  res.json({
    exito:  true,
    token,
    nombre: usuario.nombre,
    rol:    usuario.rol
  });
});

/**
 * GET /api/auth/verify
 * Verifica si el token JWT del header es válido
 * Usado por el panel admin al cargar para saber si la sesión sigue activa
 */
app.get('/api/auth/verify', verificarToken, (req, res) => {
  // Si llegó aquí, el token es válido (el middleware lo verificó)
  res.json({
    exito:   true,
    usuario: req.usuario
  });
});

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
 * GET /api/contacto/stats
 * Devuelve estadísticas del panel de administración:
 * total de mensajes, mensajes de hoy, y el mensaje más reciente
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/contacto/stats', verificarToken, (_req, res) => {
  const total          = contarMensajes();
  const hoy            = contarMensajesHoy();
  const mensajeReciente = obtenerMensajeReciente();

  res.json({
    exito: true,
    total,
    hoy,
    reciente: mensajeReciente || null
  });
});

/**
 * DELETE /api/contacto/:id
 * Elimina un mensaje de la base de datos por su id
 * :id es un parámetro dinámico en la URL (ej: /api/contacto/5)
 * PROTEGIDA: requiere token JWT válido
 */
app.delete('/api/contacto/:id', verificarToken, (req, res) => {
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
// PAGOS CON STRIPE
// Crea una sesión de pago y devuelve la URL de checkout
// =============================================

// Mapa de planes a variables de entorno con el price de Stripe
const PRECIOS_STRIPE = {
  starter:    process.env.STRIPE_PRICE_STARTER,
  pro:        process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

// Ruta para crear sesión de pago con Stripe
// Recibe: { plan: 'starter' | 'pro' | 'enterprise' }
app.post('/api/crear-sesion-pago', async (req, res) => {
  try {
    const { plan } = req.body;
    const priceId = PRECIOS_STRIPE[plan];

    if (!priceId) {
      return res.status(400).json({ error: 'Plan no válido.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      metadata: { plan }, // Guardamos el plan para leerlo en el webhook
      success_url: 'http://localhost:3001/pago-exitoso.html',
      cancel_url:  'http://localhost:3001/pages/precios.html',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error al crear sesión de Stripe:', error);
    res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
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
