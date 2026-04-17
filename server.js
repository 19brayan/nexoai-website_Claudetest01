// =============================================
// SERVIDOR PRINCIPAL DE NEXOAI
// Levanta un servidor Express que:
//   1. Sirve el sitio web estático (HTML, CSS, JS)
//   2. Expone una API REST para el formulario de contacto
//   3. Almacena los mensajes en una base de datos SQLite
// =============================================

require('dotenv').config(); // Carga las variables del .env
const stripe          = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend }      = require('resend');
const resend          = new Resend(process.env.RESEND_API_KEY);
const Anthropic       = require('@anthropic-ai/sdk');
const anthropic       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  guardarSuscripcion,
  obtenerSuscripciones
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

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('[WEBHOOK] Evento recibido de Stripe');

  const firma = req.headers['stripe-signature'];
  console.log('[WEBHOOK] Firma presente:', !!firma);

  let evento;
  try {
    evento = stripe.webhooks.constructEvent(
      req.body,
      firma,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('[WEBHOOK] Firma verificada. Tipo de evento:', evento.type);
  } catch (error) {
    console.error('[WEBHOOK] Firma inválida:', error.message);
    return res.status(400).json({ error: 'Firma inválida' });
  }

  if (evento.type === 'checkout.session.completed') {
    const sesion = evento.data.object;

    console.log('[WEBHOOK] Session ID:', sesion.id);
    console.log('[WEBHOOK] customer_details:', JSON.stringify(sesion.customer_details));
    console.log('[WEBHOOK] metadata:', JSON.stringify(sesion.metadata));

    const email = sesion.customer_details?.email || 'desconocido';
    const plan  = sesion.metadata?.plan || 'desconocido';

    console.log(`[WEBHOOK] Guardando suscripción — email: ${email}, plan: ${plan}`);

    try {
      const suscripcion = guardarSuscripcion(email, plan, sesion.id);
      console.log('[WEBHOOK] Suscripción guardada:', JSON.stringify(suscripcion));
    } catch (dbError) {
      console.error('[WEBHOOK] Error al guardar en BD:', dbError.message);
    }

    // Envía email de bienvenida al cliente via Resend
    try {
      await resend.emails.send({
        from: 'NexoAI <onboarding@resend.dev>',
        to:   email,
        subject: `¡Bienvenido a NexoAI ${plan}!`,
        html: `
          <div style="background:#1a1a2e;color:#ffffff;font-family:Arial,sans-serif;padding:40px;max-width:600px;margin:0 auto;border-radius:12px;">
            <h1 style="color:#6C63FF;font-size:2rem;margin-bottom:10px;">¡Pago exitoso!</h1>
            <p style="font-size:1.1rem;color:#b0b0b0;margin-bottom:20px;">Gracias por unirte a NexoAI. Tu suscripción está activa.</p>
            <div style="background:#16213e;border-radius:8px;padding:20px;margin-bottom:30px;">
              <p style="margin:0;font-size:0.9rem;color:#b0b0b0;text-transform:uppercase;letter-spacing:1px;">Plan contratado</p>
              <p style="margin:8px 0 0;font-size:1.5rem;font-weight:bold;color:#6C63FF;text-transform:capitalize;">${plan}</p>
            </div>
            <a href="https://nexoai-website-claudetest01.onrender.com"
               style="display:inline-block;background:#6C63FF;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;">
              Ir a NexoAI
            </a>
            <p style="margin-top:30px;font-size:0.8rem;color:#555;">© 2026 NexoAI - Todos los derechos reservados</p>
          </div>
        `
      });
      console.log(`[WEBHOOK] 📧 Email de bienvenida enviado a: ${email}`);
    } catch (emailError) {
      console.error('[WEBHOOK] Error al enviar email:', emailError.message);
    }

    console.log(`[WEBHOOK] ✅ Pago exitoso: ${email} — Plan: ${plan}`);
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

/**
 * GET /api/suscripciones
 * Devuelve todas las suscripciones registradas, ordenadas por fecha descendente.
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/suscripciones', verificarToken, (_req, res) => {
  const suscripciones = obtenerSuscripciones();
  res.json({ ok: true, data: suscripciones });
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
      success_url: 'https://nexoai-website-claudetest01.onrender.com/pago-exitoso.html',
      cancel_url:  'https://nexoai-website-claudetest01.onrender.com/pages/precios.html',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error al crear sesión de Stripe:', error);
    res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
});

// =============================================
// AGENTE DE ATENCIÓN AL CLIENTE (ANTHROPIC)
// Recibe un mensaje del usuario y devuelve una
// respuesta generada por Claude actuando como
// el agente de soporte de NexoAI.
// =============================================

/**
 * POST /api/agente
 * Recibe: { mensajes } — array con el historial completo de la conversación
 *   en formato [{ role: "user"|"assistant", content: "texto" }, ...]
 * Por compatibilidad también acepta { mensaje } (string) y lo convierte a array.
 * Devuelve: { ok: true, respuesta: "..." } con la respuesta del agente
 */
app.post('/api/agente', async (req, res) => {
  const { mensaje, mensajes } = req.body;

  // Construye el array de mensajes según lo que llegue:
  // - Si llega "mensajes" (array), lo usa directamente
  // - Si llega "mensaje" (string, compatibilidad), lo envuelve en array
  let historial;
  if (Array.isArray(mensajes) && mensajes.length > 0) {
    historial = mensajes;
  } else if (typeof mensaje === 'string' && mensaje.trim()) {
    historial = [{ role: 'user', content: mensaje.trim() }];
  } else {
    return res.status(400).json({ ok: false, error: 'Se requiere "mensajes" (array) o "mensaje" (string).' });
  }

  try {
    const respuesta = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      system: `Eres el agente de atención al cliente de NexoAI, una empresa que crea soluciones de software con inteligencia artificial.

Conoces a la perfección los tres planes disponibles:
- Plan Starter: $1/mes — ideal para emprendedores y equipos pequeños que quieren dar sus primeros pasos con IA.
- Plan Pro: $10/mes — diseñado para empresas en crecimiento que necesitan más potencia y funcionalidades avanzadas.
- Plan Enterprise: $100/mes — solución completa para grandes organizaciones con necesidades personalizadas.

Responde siempre en español, con un tono profesional pero amigable y cercano. Si no sabes la respuesta a alguna pregunta específica, dí: "Para darte la mejor atención, te conecto con el equipo de NexoAI."`,
      messages: historial
    });

    const texto = respuesta.content[0].text;
    res.json({ ok: true, respuesta: texto });
  } catch (error) {
    console.error('[AGENTE] Status:', error.status);
    console.error('[AGENTE] Mensaje:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudo obtener respuesta del agente.' });
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
