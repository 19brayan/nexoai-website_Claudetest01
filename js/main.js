/* =============================================
   MAIN.JS — NexoAI
   Lógica compartida para todas las páginas:
   - Menú hamburguesa para móvil
   - Scroll suave al hacer clic en enlaces de navegación
   - Validación del formulario de contacto
============================================= */

// Espera a que el DOM esté completamente cargado antes de ejecutar
document.addEventListener('DOMContentLoaded', () => {

  /* -------------------------------------------
     MENÚ HAMBURGUESA
     Abre y cierra el menú en pantallas pequeñas
  ------------------------------------------- */
  const menuToggle = document.getElementById('menuToggle');
  const navLinks   = document.getElementById('navLinks');

  if (menuToggle && navLinks) {

    // Alterna la clase "open" al hacer clic en el botón hamburguesa
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });

    // Cierra el menú al hacer clic en cualquier enlace del menú
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
  }

  /* -------------------------------------------
     SCROLL SUAVE
     Desplaza la página suavemente al hacer clic
     en enlaces que apuntan a secciones (#id)
     Solo aplica en la página principal (index)
  ------------------------------------------- */
  document.querySelectorAll('a[href^="#"]').forEach(enlace => {
    enlace.addEventListener('click', (e) => {
      const destino = document.querySelector(enlace.getAttribute('href'));

      // Solo actúa si el destino existe en la página actual
      if (destino) {
        e.preventDefault();
        destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  /* -------------------------------------------
     MARCAR ENLACE ACTIVO EN LA NAVEGACIÓN
     Resalta el enlace del menú que corresponde
     a la página que está abierta actualmente
  ------------------------------------------- */
  const paginaActual = window.location.pathname.split('/').pop();

  document.querySelectorAll('.nav-links a').forEach(link => {
    const destino = link.getAttribute('href').split('/').pop();

    // Compara el nombre del archivo actual con el href del enlace
    if (destino === paginaActual || (paginaActual === '' && destino === 'index.html')) {
      link.classList.add('activo');
    }
  });

  /* -------------------------------------------
     VALIDACIÓN DEL FORMULARIO DE CONTACTO
     Verifica que todos los campos tengan contenido
     antes de permitir el envío. Muestra errores
     en línea en lugar de un alert genérico.
  ------------------------------------------- */
  const contactForm = document.getElementById('contactForm');

  if (contactForm) {
    const formSuccess = document.getElementById('formSuccess');

    contactForm.addEventListener('submit', (e) => {
      e.preventDefault(); // Evita el envío real (modo demo)

      let formularioValido = true;

      // Obtiene todos los campos obligatorios del formulario
      const camposRequeridos = contactForm.querySelectorAll('[required]');

      camposRequeridos.forEach(campo => {
        const errorMsg = campo.parentElement.querySelector('.error-msg');
        const valor    = campo.value.trim();

        if (!valor) {
          // Marca el campo con clase de error y muestra el mensaje
          campo.classList.add('error');
          if (errorMsg) errorMsg.classList.add('visible');
          formularioValido = false;
        } else {
          // Limpia el error si el campo fue completado
          campo.classList.remove('error');
          if (errorMsg) errorMsg.classList.remove('visible');
        }

        // Valida formato de email específicamente
        if (campo.type === 'email' && valor) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(valor)) {
            campo.classList.add('error');
            if (errorMsg) {
              errorMsg.textContent = 'Ingresa un correo electrónico válido.';
              errorMsg.classList.add('visible');
            }
            formularioValido = false;
          }
        }
      });

      // Si todo es válido, muestra el mensaje de éxito
      if (formularioValido) {
        contactForm.querySelectorAll('.form-group, .btn-submit').forEach(el => {
          el.style.display = 'none';
        });
        if (formSuccess) formSuccess.style.display = 'block';
      }
    });

    // Limpia el error de un campo en tiempo real cuando el usuario escribe
    contactForm.querySelectorAll('[required]').forEach(campo => {
      campo.addEventListener('input', () => {
        if (campo.value.trim()) {
          campo.classList.remove('error');
          const errorMsg = campo.parentElement.querySelector('.error-msg');
          if (errorMsg) errorMsg.classList.remove('visible');
        }
      });
    });
  }

});
