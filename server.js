// =============================================
// SERVIDOR PRINCIPAL DE NEXOAI
// Levanta un servidor Express que:
//   1. Sirve el sitio web estático (HTML, CSS, JS)
//   2. Expone una API REST para el formulario de contacto
//   3. Almacena los mensajes en Turso (nube) o SQLite local
// =============================================

require('dotenv').config(); // Carga las variables del .env
const stripe          = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend }      = require('resend');
const resend          = new Resend(process.env.RESEND_API_KEY);
const Anthropic       = require('@anthropic-ai/sdk');
const anthropic       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const express = require('express'); // Framework para crear el servidor web
const jwt     = require('jsonwebtoken'); // Para crear y verificar tokens JWT
const bcrypt  = require('bcryptjs');    // Para hashear passwords de clientes

// Importa las funciones de acceso a la base de datos
const {
  inicializarDB,
  guardarMensaje,
  obtenerMensajes,
  eliminarMensaje,
  contarMensajes,
  contarMensajesHoy,
  obtenerMensajeReciente,
  buscarUsuarioPorUsername,
  verificarPassword,
  guardarSuscripcion,
  obtenerSuscripciones,
  buscarContactoPorEmail,
  guardarConversacion,
  obtenerConversaciones,
  obtenerAnalytics,
  actualizarPlanUsuario,
  crearUsuario,
  buscarUsuarioPorEmail,
  buscarUsuarioPorId,
  completarOnboarding,
  guardarPerfilNegocio,
  buscarSuscripcionActivaPorEmail
} = require('./db/database');

// Clave secreta para firmar los tokens JWT
const JWT_SECRET = 'nexoai_secret_2026';

// Inicialización de la aplicación Express
const app  = express();
// En Render, el puerto lo asigna la plataforma via variable de entorno PORT.
const PORT = process.env.PORT || 3001;

// =============================================
// MIDDLEWARE
// =============================================

// =============================================
// WEBHOOK DE STRIPE
// Debe ir ANTES de express.json() porque Stripe
// requiere el body en formato raw (sin parsear)
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
      const suscripcion = await guardarSuscripcion(email, plan, sesion.id);
      console.log('[WEBHOOK] Suscripción guardada:', JSON.stringify(suscripcion));

      // Sincroniza el plan en la tabla clientes (crea el registro si no existe)
      const cliente = await actualizarPlanUsuario(email, plan);
      console.log(`[WEBHOOK] Plan de cliente actualizado: ${email} → ${plan} (id: ${cliente?.id})`);
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
      console.log(`[WEBHOOK] Email de bienvenida enviado a: ${email}`);
    } catch (emailError) {
      console.error('[WEBHOOK] Error al enviar email:', emailError.message);
    }

    console.log(`[WEBHOOK] Pago exitoso: ${email} — Plan: ${plan}`);
  }

  res.status(200).json({ received: true });
});

// Permite que Express entienda el cuerpo de peticiones en formato JSON
app.use(express.json());

// Sirve todos los archivos estáticos del proyecto (HTML, CSS, JS)
app.use(express.static(__dirname));

// =============================================
// MIDDLEWARE DE AUTENTICACIÓN
// Verifica que el token JWT sea válido antes de
// permitir acceso a rutas protegidas
// =============================================

function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      exito: false,
      error: 'Acceso no autorizado. Se requiere token de sesión.'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) {
      return res.status(401).json({
        exito: false,
        error: 'Token inválido o expirado. Inicia sesión nuevamente.'
      });
    }
    req.usuario = usuario;
    next();
  });
}

// Solo permite acceso a usuarios con rol "admin"
function verificarAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  next();
}

// Permite acceso a clientes y también a admins
function verificarCliente(req, res, next) {
  const rol = req.usuario?.rol;
  if (rol !== 'cliente' && rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  next();
}

// =============================================
// RUTAS DE AUTENTICACIÓN
// =============================================

/**
 * POST /api/auth/login
 * Recibe: { username, password }
 * Verifica las credenciales y devuelve un token JWT si son correctas
 */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      exito: false,
      error: 'El usuario y la contraseña son obligatorios.'
    });
  }

  const usuario = await buscarUsuarioPorUsername(username.trim());

  if (!usuario || !verificarPassword(password, usuario.password_hash)) {
    return res.status(401).json({
      exito: false,
      error: 'Usuario o contraseña incorrectos.'
    });
  }

  // Token JWT con expiración de 8 horas
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
 */
app.get('/api/auth/verify', verificarToken, (req, res) => {
  res.json({ exito: true, usuario: req.usuario });
});

// =============================================
// RUTAS DE LA API — MENSAJES / CONTACTO
// =============================================

/**
 * POST /api/contacto
 * Recibe: { nombre, email, mensaje }
 * Guarda el mensaje en la base de datos
 */
app.post('/api/contacto', async (req, res) => {
  const { nombre, email, mensaje } = req.body;

  if (!nombre || !email || !mensaje) {
    return res.status(400).json({
      exito: false,
      error: 'Todos los campos son obligatorios: nombre, email y mensaje.'
    });
  }

  const nuevoMensaje = await guardarMensaje(
    nombre.trim(),
    email.trim().toLowerCase(),
    mensaje.trim()
  );

  console.log(`[API] Nuevo mensaje de ${nuevoMensaje.nombre} (${nuevoMensaje.email})`);

  res.status(201).json({
    exito:   true,
    mensaje: '¡Mensaje recibido! Te responderemos pronto.',
    datos:   nuevoMensaje
  });
});

/**
 * GET /api/contacto
 * Devuelve todos los mensajes del más reciente al más antiguo
 */
app.get('/api/contacto', verificarToken, verificarAdmin, async (_req, res) => {
  const mensajes = await obtenerMensajes();
  res.json({ exito: true, total: mensajes.length, datos: mensajes });
});

/**
 * GET /api/contacto/count
 * Devuelve el conteo total de mensajes
 */
app.get('/api/contacto/count', async (_req, res) => {
  const total = await contarMensajes();
  res.json({ exito: true, total });
});

/**
 * GET /api/contacto/stats
 * Devuelve estadísticas del panel de administración
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/contacto/stats', verificarToken, async (_req, res) => {
  const total           = await contarMensajes();
  const hoy             = await contarMensajesHoy();
  const mensajeReciente = await obtenerMensajeReciente();

  res.json({
    exito: true,
    total,
    hoy,
    reciente: mensajeReciente || null
  });
});

/**
 * DELETE /api/contacto/:id
 * Elimina un mensaje por su id
 * PROTEGIDA: requiere token JWT válido
 */
app.delete('/api/contacto/:id', verificarToken, verificarAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.status(400).json({ exito: false, error: 'El id debe ser un número válido.' });
  }

  const eliminado = await eliminarMensaje(id);

  if (!eliminado) {
    return res.status(404).json({
      exito: false,
      error: `No se encontró ningún mensaje con id ${id}.`
    });
  }

  console.log(`[API] Mensaje con id ${id} eliminado.`);
  res.json({ exito: true, mensaje: `Mensaje con id ${id} eliminado correctamente.` });
});

/**
 * GET /api/conversaciones/:contacto_id
 * Devuelve el historial acumulado de sesiones de un contacto del agente.
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/conversaciones/:contacto_id', verificarToken, async (req, res) => {
  const contacto_id = parseInt(req.params.contacto_id, 10);

  if (isNaN(contacto_id)) {
    return res.status(400).json({ ok: false, error: 'contacto_id inválido.' });
  }

  const sesiones = await obtenerConversaciones(contacto_id);

  if (!sesiones.length) {
    return res.status(404).json({ ok: false, error: 'No se encontró conversación para este contacto.' });
  }

  res.json({ ok: true, sesiones });
});

// =============================================
// RUTAS DE CLIENTES (PORTAL DE USUARIO)
// Registro, login y perfil de clientes finales.
// Coexisten con el sistema de admins (/api/auth)
// usando el campo "rol" del JWT para distinguirlos.
// =============================================

/**
 * POST /api/usuarios/registro
 * Recibe: { email, password, nombre }
 * Crea un cliente nuevo con plan "starter"
 */
app.post('/api/usuarios/registro', async (req, res) => {
  const { email, password, nombre } = req.body;

  if (!email || !password || !nombre) {
    return res.status(400).json({ ok: false, error: 'email, password y nombre son obligatorios.' });
  }

  const emailNorm = email.trim().toLowerCase();

  // Verifica que el email no esté ya registrado
  const existente = await buscarUsuarioPorEmail(emailNorm);
  if (existente) {
    return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese email.' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  await crearUsuario(emailNorm, password_hash, nombre.trim(), 'starter');

  console.log(`[CLIENTES] Registro: ${emailNorm}`);
  res.status(201).json({ ok: true, mensaje: 'Usuario creado' });
});

/**
 * POST /api/usuarios/login
 * Recibe: { email, password }
 * Devuelve JWT con rol: "cliente" — distinto al JWT de admins (rol: "admin")
 */
app.post('/api/usuarios/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'email y password son obligatorios.' });
  }

  const usuario = await buscarUsuarioPorEmail(email.trim().toLowerCase());

  if (!usuario || !usuario.password_hash || !bcrypt.compareSync(password, usuario.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos.' });
  }

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, nombre: usuario.nombre, plan: usuario.plan, rol: 'cliente' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[CLIENTES] Login: ${usuario.email}`);
  res.json({ ok: true, token, usuario: { nombre: usuario.nombre, email: usuario.email, plan: usuario.plan } });
});

/**
 * GET /api/usuarios/perfil
 * Devuelve datos del cliente autenticado + sus conversaciones con el agente.
 * PROTEGIDA: requiere JWT con rol "cliente"
 */
app.get('/api/usuarios/perfil', verificarToken, verificarCliente, async (req, res) => {
  const usuario = await buscarUsuarioPorId(req.usuario.id);
  if (!usuario) {
    return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
  }

  // Busca conversaciones del agente vinculadas a su email
  const contacto       = await buscarContactoPorEmail(usuario.email);
  const conversaciones = contacto ? await obtenerConversaciones(contacto.id) : [];

  // Verifica si tiene suscripción activa (para el paso de plan en onboarding)
  const suscripcion = await buscarSuscripcionActivaPorEmail(usuario.email);

  res.json({
    ok: true,
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, plan: usuario.plan, estado: usuario.estado, onboarding_completo: usuario.onboarding_completo, fecha_registro: usuario.fecha_registro },
    conversaciones,
    suscripcion: suscripcion || null
  });
});

/**
 * POST /api/usuarios/perfil-negocio
 * Guarda el JSON del perfil de negocio del cliente autenticado.
 * PROTEGIDA: requiere JWT con rol "cliente"
 */
app.post('/api/usuarios/perfil-negocio', verificarToken, verificarCliente, async (req, res) => {
  try {
    await guardarPerfilNegocio(req.usuario.id, req.body);
    console.log(`[CLIENTES] Perfil de negocio guardado: id ${req.usuario.id}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[CLIENTES] Error al guardar perfil:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudo guardar el perfil.' });
  }
});

/**
 * POST /api/usuarios/onboarding-completo
 * Marca el onboarding del cliente autenticado como completado.
 * PROTEGIDA: requiere JWT con rol "cliente"
 */
app.post('/api/usuarios/onboarding-completo', verificarToken, verificarCliente, async (req, res) => {
  try {
    const usuario = await completarOnboarding(req.usuario.id);
    console.log(`[CLIENTES] Onboarding completado: id ${req.usuario.id}`);
    res.json({ ok: true, usuario });
  } catch (error) {
    console.error('[CLIENTES] Error al completar onboarding:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudo actualizar el onboarding.' });
  }
});

/**
 * GET /api/analytics
 * Devuelve métricas del negocio: conversaciones, leads, suscriptores y tasa de conversión.
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/analytics', verificarToken, verificarAdmin, async (_req, res) => {
  try {
    const datos = await obtenerAnalytics();
    res.json({ ok: true, ...datos });
  } catch (error) {
    console.error('[ANALYTICS] Error:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener las métricas.' });
  }
});

/**
 * GET /api/suscripciones
 * Devuelve todas las suscripciones registradas
 * PROTEGIDA: requiere token JWT válido
 */
app.get('/api/suscripciones', verificarToken, verificarAdmin, async (_req, res) => {
  const suscripciones = await obtenerSuscripciones();
  res.json({ ok: true, data: suscripciones });
});

// =============================================
// PAGOS CON STRIPE
// =============================================

const PRECIOS_STRIPE = {
  starter:    process.env.STRIPE_PRICE_STARTER,
  pro:        process.env.STRIPE_PRICE_PRO,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
};

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
      metadata: { plan },
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
// =============================================

// Herramientas disponibles para el agente
const TOOLS_AGENTE = [
  {
    name: 'guardar_contacto',
    description: 'Guarda los datos de contacto de un cliente interesado en NexoAI',
    input_schema: {
      type: 'object',
      properties: {
        nombre:  { type: 'string', description: 'Nombre del cliente' },
        email:   { type: 'string', description: 'Email del cliente' },
        interes: { type: 'string', description: 'En qué plan está interesado' }
      },
      required: ['nombre', 'email', 'interes']
    }
  }
];

// System prompt compartido para las dos llamadas del agente
const SYSTEM_AGENTE = `Eres el agente de atención al cliente de NexoAI, una empresa que crea soluciones de software con inteligencia artificial.

Conoces a la perfección los tres planes disponibles:
- Plan Starter: $1/mes — ideal para emprendedores y equipos pequeños que quieren dar sus primeros pasos con IA.
- Plan Pro: $10/mes — diseñado para empresas en crecimiento que necesitan más potencia y funcionalidades avanzadas.
- Plan Enterprise: $100/mes — solución completa para grandes organizaciones con necesidades personalizadas.

Responde siempre en español, con un tono profesional pero amigable y cercano. Si no sabes la respuesta a alguna pregunta específica, dí: "Para darte la mejor atención, te conecto con el equipo de NexoAI."

Cuando el usuario muestre interés en un plan o pida que lo contacten, y proporcione su nombre y email, usa la herramienta guardar_contacto para registrar sus datos.

Cuando el usuario proporcione su nombre Y email en el mismo mensaje, DEBES usar la herramienta guardar_contacto inmediatamente. No preguntes confirmación, no digas que tomaste nota — ejecuta la herramienta.`;

/**
 * POST /api/agente
 * Recibe: { mensajes } — historial completo [{ role, content }, ...]
 * Por compatibilidad acepta { mensaje } (string) y lo convierte a array.
 * Soporta tool_use: guarda contacto y acumula conversación en BD.
 * Devuelve: { ok: true, respuesta: "..." }
 */
app.post('/api/agente', async (req, res) => {
  const { mensaje, mensajes } = req.body;

  let historial;
  if (Array.isArray(mensajes) && mensajes.length > 0) {
    historial = mensajes;
  } else if (typeof mensaje === 'string' && mensaje.trim()) {
    historial = [{ role: 'user', content: mensaje.trim() }];
  } else {
    return res.status(400).json({ ok: false, error: 'Se requiere "mensajes" (array) o "mensaje" (string).' });
  }

  try {
    // Primera llamada: Claude puede responder o invocar una herramienta
    const primeraRespuesta = await anthropic.messages.create({
      model:       'claude-opus-4-5',
      max_tokens:  500,
      system:      SYSTEM_AGENTE,
      tools:       TOOLS_AGENTE,
      tool_choice: { type: 'auto' },
      messages:    historial
    });

    // Si Claude no usó herramienta, devuelve la respuesta directamente
    if (primeraRespuesta.stop_reason !== 'tool_use') {
      const texto = primeraRespuesta.content[0].text;
      return res.json({ ok: true, respuesta: texto });
    }

    // Claude invocó guardar_contacto — extrae los inputs
    const bloqueHerramienta = primeraRespuesta.content.find(b => b.type === 'tool_use');
    const { nombre, email, interes } = bloqueHerramienta.input;

    console.log(`[AGENTE] Tool use — guardar_contacto: ${nombre} | ${email} | ${interes}`);

    // Busca si el email ya tiene registro para no duplicar contactos
    const contactoExistente = await buscarContactoPorEmail(email);
    let contactoId;

    if (contactoExistente) {
      contactoId = contactoExistente.id;
      console.log(`[AGENTE] Contacto ya existe id ${contactoId} — no se duplica`);
    } else {
      const contactoNuevo = await guardarMensaje(nombre, email, `Interés: ${interes}`, 'agente');
      contactoId = contactoNuevo.id;
      console.log(`[AGENTE] Contacto nuevo guardado con id ${contactoId}`);
    }

    // Acumula la sesión actual al historial del contacto (origen: agente de ventas)
    await guardarConversacion(contactoId, historial, 'ventas');
    console.log(`[AGENTE] Sesión acumulada para contacto id ${contactoId}`);

    // Segunda llamada: Claude genera la confirmación al usuario
    const historialConTool = [
      ...historial,
      { role: 'assistant', content: primeraRespuesta.content },
      {
        role: 'user',
        content: [
          {
            type:        'tool_result',
            tool_use_id: bloqueHerramienta.id,
            content:     `Contacto registrado correctamente. id: ${contactoId}`
          }
        ]
      }
    ];

    const segundaRespuesta = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 500,
      system:     SYSTEM_AGENTE,
      tools:      TOOLS_AGENTE,
      messages:   historialConTool
    });

    const textoFinal = segundaRespuesta.content[0].text;
    res.json({ ok: true, respuesta: textoFinal });

  } catch (error) {
    console.error('[AGENTE] Status:', error.status);
    console.error('[AGENTE] Mensaje:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudo obtener respuesta del agente.' });
  }
});

// =============================================
// SISTEMA MULTI-AGENTE
// El orquestador analiza el mensaje del usuario y
// lo deriva al agente especializado correcto.
// =============================================

// Prompt del orquestador: clasifica el mensaje en una sola palabra
const SYSTEM_ORQUESTADOR = `Eres un orquestador. Analiza el último mensaje del usuario y responde SOLO con una de estas palabras: ventas, soporte, faq.
- ventas: si menciona precios, planes, quiere comprar o dar sus datos
- soporte: si tiene un problema técnico o de acceso
- faq: cualquier otra pregunta general`;

// Agente especializado en ventas — recomienda planes y guarda contactos
const AGENTE_VENTAS = `Eres el especialista en ventas de NexoAI, una empresa que crea soluciones de software con inteligencia artificial.

Conoces a la perfección los tres planes disponibles:
- Plan Starter: $1/mes — ideal para emprendedores y equipos pequeños que quieren dar sus primeros pasos con IA.
- Plan Pro: $10/mes — diseñado para empresas en crecimiento que necesitan más potencia y funcionalidades avanzadas.
- Plan Enterprise: $100/mes — solución completa para grandes organizaciones con necesidades personalizadas.

Tu objetivo es entender el negocio del cliente, hacer las preguntas correctas y recomendar el plan que mejor se adapte a sus necesidades. Sé consultivo, no agresivo.

Cuando tengas el nombre y email del cliente, usa la herramienta guardar_contacto inmediatamente para registrar sus datos. No pidas confirmación — ejecuta la herramienta.

Responde siempre en español, con un tono profesional, cálido y orientado a resultados.`;

// Agente especializado en soporte técnico
const AGENTE_SOPORTE = `Eres el especialista en soporte técnico de NexoAI, una empresa que crea soluciones de software con inteligencia artificial.

Ayudas a los clientes con:
- Problemas de acceso a su cuenta o panel
- Dudas sobre pagos, facturas y suscripciones
- Configuración inicial de los servicios contratados
- Errores o comportamientos inesperados en la plataforma

Tu tono es empático, paciente y resolutivo. Siempre reconoces el problema del cliente antes de proponer soluciones. Si necesitas más información para diagnosticar el problema, haz preguntas concretas una a la vez.

Si el problema está fuera de tu alcance o requiere intervención del equipo técnico, dí: "Voy a escalar tu caso al equipo técnico de NexoAI. Te contactaremos en menos de 24 horas."

Responde siempre en español.`;

// Agente especializado en preguntas generales (FAQ)
const AGENTE_FAQ = `Eres el especialista en información general de NexoAI, una empresa que crea soluciones de software con inteligencia artificial.

Respondes preguntas sobre:
- Qué es NexoAI y a qué se dedica
- Cómo funcionan los servicios: desarrollo web, automatización con IA, consultoría tecnológica
- Casos de uso reales de inteligencia artificial en empresas
- Diferencias entre NexoAI y otras opciones del mercado
- Tecnologías que utilizamos y metodología de trabajo

Tu tono es educativo, claro y accesible. Usas ejemplos concretos cuando ayudan a entender conceptos técnicos. No inventas información — si no sabes algo, dices: "Para más detalles sobre ese tema, te recomiendo hablar con nuestro equipo."

Responde siempre en español.`;

// Mapa de clave → system prompt para selección dinámica
const AGENTES = {
  ventas:  AGENTE_VENTAS,
  soporte: AGENTE_SOPORTE,
  faq:     AGENTE_FAQ
};

/**
 * POST /api/orquestador
 * Recibe: { mensajes: [...historial] }
 * 1. Llama a Claude como orquestador para clasificar el mensaje (ventas/soporte/faq)
 * 2. Llama a Claude con el agente especializado correspondiente
 * 3. El agente de ventas puede invocar guardar_contacto (tool_use)
 * Devuelve: { ok: true, respuesta: "...", agente: "ventas|soporte|faq" }
 */
app.post('/api/orquestador', verificarToken, verificarCliente, async (req, res) => {
  const { mensajes } = req.body;

  if (!Array.isArray(mensajes) || mensajes.length === 0) {
    return res.status(400).json({ ok: false, error: 'Se requiere "mensajes" (array no vacío).' });
  }

  try {
    // — Paso 1: El orquestador clasifica el último mensaje —
    const clasificacion = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 10, // Solo necesita responder una palabra
      system:     SYSTEM_ORQUESTADOR,
      messages:   mensajes
    });

    // Extrae la palabra clave y valida que sea una de las esperadas
    const claveAgente = clasificacion.content[0].text.trim().toLowerCase();
    const agente      = AGENTES[claveAgente] ? claveAgente : 'faq'; // fallback a faq

    console.log(`[ORQUESTADOR] Clasificación: "${claveAgente}" → agente: ${agente}`);

    // — Paso 2: El agente especializado genera la respuesta —
    const primeraRespuesta = await anthropic.messages.create({
      model:       'claude-opus-4-5',
      max_tokens:  500,
      system:      AGENTES[agente],
      tools:       agente === 'ventas' ? TOOLS_AGENTE : [], // solo ventas usa tools
      tool_choice: agente === 'ventas' ? { type: 'auto' } : undefined,
      messages:    mensajes
    });

    // Si el agente de ventas no invocó herramienta, responde directo
    if (primeraRespuesta.stop_reason !== 'tool_use') {
      const texto = primeraRespuesta.content[0].text;
      console.log(`[ORQUESTADOR] Enviando al frontend → agente: ${agente} | respuesta: "${texto.slice(0, 60)}..."`);
      return res.json({ ok: true, respuesta: texto, agente });
    }

    // — Paso 3 (solo ventas): maneja tool_use guardar_contacto —
    const bloqueHerramienta = primeraRespuesta.content.find(b => b.type === 'tool_use');
    const { nombre, email, interes } = bloqueHerramienta.input;

    console.log(`[ORQUESTADOR] Tool use — guardar_contacto: ${nombre} | ${email} | ${interes}`);

    // Upsert: reutiliza el id si el email ya existe, si no crea nuevo registro
    const contactoExistente = await buscarContactoPorEmail(email);
    let contactoId;

    if (contactoExistente) {
      contactoId = contactoExistente.id;
      console.log(`[ORQUESTADOR] Contacto ya existe id ${contactoId} — no se duplica`);
    } else {
      const contactoNuevo = await guardarMensaje(nombre, email, `Interés: ${interes}`, 'agente');
      contactoId = contactoNuevo.id;
      console.log(`[ORQUESTADOR] Contacto nuevo guardado con id ${contactoId}`);
    }

    // Acumula la sesión al historial del contacto con el tipo de agente
    await guardarConversacion(contactoId, mensajes, agente);
    console.log(`[ORQUESTADOR] Sesión acumulada para contacto id ${contactoId}`);

    // Segunda llamada para que el agente confirme al usuario
    const historialConTool = [
      ...mensajes,
      { role: 'assistant', content: primeraRespuesta.content },
      {
        role: 'user',
        content: [
          {
            type:        'tool_result',
            tool_use_id: bloqueHerramienta.id,
            content:     `Contacto registrado correctamente. id: ${contactoId}`
          }
        ]
      }
    ];

    const segundaRespuesta = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 500,
      system:     AGENTES[agente],
      tools:      TOOLS_AGENTE,
      messages:   historialConTool
    });

    const textoFinal = segundaRespuesta.content[0].text;
    console.log(`[ORQUESTADOR] Enviando al frontend (tool_use) → agente: ${agente} | respuesta: "${textoFinal.slice(0, 60)}..."`);
    res.json({ ok: true, respuesta: textoFinal, agente });

  } catch (error) {
    console.error('[ORQUESTADOR] Error:', error.message);
    res.status(500).json({ ok: false, error: 'No se pudo procesar la solicitud.' });
  }
});

// =============================================
// INICIO DEL SERVIDOR
// Primero inicializa la BD (crea tablas y seed),
// luego levanta Express en el puerto configurado.
// =============================================
inicializarDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✓ Servidor NexoAI corriendo en http://localhost:${PORT}`);
      console.log(`✓ API disponible en http://localhost:${PORT}/api/contacto`);
    });
  })
  .catch((err) => {
    console.error('[DB] Error al inicializar la base de datos:', err);
    process.exit(1);
  });
