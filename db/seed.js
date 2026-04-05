// =============================================
// SEED.JS — DATOS INICIALES DE LA BASE DE DATOS
// Crea el usuario administrador por defecto.
// Ejecutar UNA SOLA VEZ con: node db/seed.js
// Si se ejecuta de nuevo, no duplica el usuario.
// =============================================

const { registrarUsuario, buscarUsuarioPorUsername } = require('./database');

// Datos del usuario administrador por defecto
const USUARIO_ADMIN = {
  username: 'admin',
  password: 'nexoai2026',
  nombre:   'Administrador',
  rol:      'admin'
};

// Verifica si el usuario ya existe antes de crearlo
// para evitar errores por username duplicado
const usuarioExistente = buscarUsuarioPorUsername(USUARIO_ADMIN.username);

if (usuarioExistente) {
  console.log(`✓ El usuario "${USUARIO_ADMIN.username}" ya existe. No se creó uno nuevo.`);
} else {
  // Crea el usuario administrador con la contraseña encriptada
  const nuevoUsuario = registrarUsuario(
    USUARIO_ADMIN.username,
    USUARIO_ADMIN.password,
    USUARIO_ADMIN.nombre,
    USUARIO_ADMIN.rol
  );

  console.log('✓ Usuario administrador creado exitosamente:');
  console.log(`  Username : ${nuevoUsuario.username}`);
  console.log(`  Nombre   : ${nuevoUsuario.nombre}`);
  console.log(`  Rol      : ${nuevoUsuario.rol}`);
  console.log(`  Creado   : ${nuevoUsuario.fecha_creacion}`);
  console.log('');
  console.log('  Para iniciar sesión usa:');
  console.log(`  Usuario  : ${USUARIO_ADMIN.username}`);
  console.log(`  Password : ${USUARIO_ADMIN.password}`);
}
