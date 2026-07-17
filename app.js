// === REGISTRO DEL SERVICE WORKER (Para que la app sea instalable) ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registrado con éxito:', registration.scope);
            })
            .catch(error => {
                console.error('Error al registrar el Service Worker:', error);
            });
    });
}

// =========================================================================
// VARIABLES GLOBALES Y ESTADO DE LA APLICACIÓN
// =========================================================================
const BACKEND_URL = "http://127.0.0.1:5000"; // URL centralizada. Cambia esta por tu IP de producción
const TELEFONO_WHATSAPP = "527442411773";
let categorySeleccionada = "todas";
let urlGlobalWhatsApp = "";

let INVENTARIO_GLOBAL = [];
let WISHLIST_GLOBAL = [];
let carrito = [];
let indicesCarrusel = {};

// VARIABLES PARA CUPONES Y LOGÍSTICA
let codigoCuponActivo = "";
let cargoPorEnvio = 0; // Siempre será 0 ya que quitamos los cargos por envío
let yaExplotoConfettiEnvio = false; // Control de disparo de confetti único

// SISTEMA DE CUPONES AVANZADO (Por categorías o globales)
const CUPONES_CONFIG = {
    "BIENVENIDA10": { descuento: 0.10, categoriaRestringida: null },
    "DAYH20": { descuento: 0.20, categoriaRestringida: null },
    "OFERTA15": { descuento: 0.15, categoriaRestringida: null },
    "KIDS20": { descuento: 0.20, categoriaRestringida: "jugueteria" },
    "MANUAL10": { descuento: 0.10, categoriaRestringida: "manualidades" }
};

const socket = typeof io !== 'undefined' ? io(BACKEND_URL) : null;

const EVENTOS_CONFIG = [
    { titulo: "🎓 Graduaciones (Manualidades)", fecha: "Mes de Julio", descripcion: "Termina una etapa llena de aprendizajes.", categoriaVinculada: "manualidades", imagen: "imagenes_eventos/graduaciones.jpg" },
    { titulo: "🎓 Graduaciones (Ropa)", fecha: "Mes de Julio", descripcion: "Termina una etapa llena de aprendizajes.", categoriaVinculada: "ropa", imagen: "imagenes_eventos/graduaciones.jpg" }
];

// =========================================================================
// SISTEMA DE AUDIO-FEEDBACK
// =========================================================================
const EFECTOS_SONIDO = {
    agregar: "https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav",
    eliminar: "https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav",
    cupon: "https://assets.mixkit.co/active_storage/sfx/2019/2019-84.wav",
    error: "https://assets.mixkit.co/active_storage/sfx/2573/2573-84.wav",
    pedido: "https://assets.mixkit.co/active_storage/sfx/1435/1435-84.wav"
};

function reproducirSonido(tipo) {
    if (!EFECTOS_SONIDO[tipo]) return;
    try {
        const audio = new Audio(EFECTOS_SONIDO[tipo]);
        audio.volume = 0.15;
        audio.play().catch(error => {
            console.log("El navegador requiere interacción previa para el audio:", error);
        });
    } catch (e) {
        console.error("Error al reproducir audio:", e);
    }
}

// =========================================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// =========================================================================
window.addEventListener('load', () => {
    configurarTema();
    configuringCamposFecha();
    recuperarCarritoDeLocalStorage();
    recuperarWishlistDeLocalStorage();
    inicializarBotónVolverArriba();
    inicializarLogicaCuponesYEnvio();

    const clienteGuardado = localStorage.getItem('nombre_cliente_dayh');
    if (clienteGuardado && document.getElementById('cliente')) {
        document.getElementById('cliente').value = clienteGuardado;
    }

    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    const buscadorInput = document.getElementById('buscador');
    if (buscadorInput && btnLimpiar) {
        buscadorInput.addEventListener('input', () => {
            btnLimpiar.style.display = buscadorInput.value.trim() ? 'block' : 'none';
            filtrarCatalogo();
        });
        btnLimpiar.addEventListener('click', () => {
            buscadorInput.value = '';
            btnLimpiar.style.display = 'none';
            filtrarCatalogo();
            buscadorInput.focus();
        });
    }

    mostrarSkeletons();
    cargarProductos(); 
    verificarCarritoGuardadoAlEntrar();
    renderizarEventos();
    setupEventListeners();
    configurarWebSockets();

    setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const productoFiltrado = urlParams.get('prod');
        if (productoFiltrado && buscadorInput) {
            buscadorInput.value = productoFiltrado;
            if (btnLimpiar) btnLimpiar.style.display = 'block';
            categorySeleccionada = "todas"; 
            filtrarCatalogo();
            const catalogoSeccion = document.getElementById('barra-categorias') || document.getElementById('lista-productos');
            if (catalogoSeccion) catalogoSeccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 900);
});

// =========================================================================
// HANDLER DEL WEBSOCKET
// =========================================================================
function configurarWebSockets() {
    if (!socket) return;
    
    socket.on('actualizar_stock_web', (data) => {
        const { codigo, nuevo_stock } = data;
        let producto = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
        if (producto) {
            producto.stock = parseInt(nuevo_stock) || 0;
            
            const itemEnCarrito = carrito.find(i => i.codigo === codigo);
            if (itemEnCarrito && itemEnCarrito.cantidad > producto.stock) {
                itemEnCarrito.cantidad = producto.stock;
                if (itemEnCarrito.cantidad <= 0) carrito = carrito.filter(c => c.codigo !== codigo);
                guardarCarritoEnLocalStorage();
                actualizarCarritoVisual(); 
            }
            
            localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
            actualizarContadoresCategorias();
            filtrarCatalogo();
            renderizarDestacados();
            renderizarWishlist();
            
            if (producto.stock === 0) {
                mostrarNotificacionFlotante(`❌ Se ha agotado en inventario: ${producto.articulo}`, 5000, '#7f1d1d');
            } else if (producto.stock <= 3) {
                mostrarNotificacionFlotante(`🔥 ¡Inventario actualizado! Últimas ${producto.stock} piezas de: ${producto.articulo}`, 5000, '#9a3412');
            }
        }
    });

    socket.on('nuevo_producto_web', (nuevoProducto) => {
        let existe = INVENTARIO_GLOBAL.some(p => p.codigo === nuevoProducto.codigo);
        if (!existe) {
            INVENTARIO_GLOBAL.unshift(nuevoProducto);
            localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
            actualizarContadoresCategorias();
            filtrarCatalogo();
            renderizarDestacados();
            mostrarNotificacionFlotante(`✨ ¡Nuevo producto agregado!: ${nuevoProducto.articulo}`, 5000, '#a855f7');
        }
    });
}

// =========================================================================
// CARGA INICIAL DE PRODUCTOS
// =========================================================================
function cargarProductos() {
    fetch('productos.json?v=' + Date.now())
        .then(res => res.json())
        .then(json => {
            INVENTARIO_GLOBAL = json.map(p => ({ 
                ...p, 
                stock: parseInt(p.stock) || 0, 
                destacado: p.destacado === true 
            }));
            
            localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
            
            actualizarContadoresCategorias();
            filtrarCatalogo();
            renderizarDestacados();
            renderizarWishlist();
            actualizarCarritoVisual();
        })
        .catch((error) => {
            console.error("Error cargando productos frescos:", error);
            let inventarioGuardado = localStorage.getItem('inventario_tienda_real');
            if (inventarioGuardado) {
                INVENTARIO_GLOBAL = JSON.parse(inventarioGuardado);
                actualizarContadoresCategorias();
                filtrarCatalogo();
                renderizarDestacados();
                renderizarWishlist();
                actualizarCarritoVisual();
            }
        });
}

// =========================================================================
// LÓGICA DE CUPONES Y PUNTOS DE ENTREGA
// =========================================================================
function inicializarLogicaCuponesYEnvio() {
    const btnCupon = document.getElementById('btn-aplicar-cupon');
    const inputCupon = document.getElementById('input-cupon');
    const msgCupon = document.getElementById('mensaje-cupon');
    const selectEntrega = document.getElementById('select-punto-entrega');

    if (btnCupon && inputCupon && msgCupon) {
        btnCupon.addEventListener('click', () => {
            const codigo = inputCupon.value.trim().toUpperCase();
            if (!codigo) {
                codigoCuponActivo = "";
                msgCupon.textContent = "";
                actualizarCarritoVisual();
                return;
            }

            if (CUPONES_CONFIG.hasOwnProperty(codigo)) {
                reproducirSonido('cupon');
                codigoCuponActivo = codigo;
                const conf = CUPONES_CONFIG[codigo];
                const textCategoria = conf.categoriaRestringida ? ` (Solo en ${conf.categoriaRestringida})` : ``;
                msgCupon.textContent = `🎟️ Cupón ${codigo} aplicado (-${conf.descuento * 100}%${textCategoria})`;
                msgCupon.className = "mensaje-cupon exito";
            } else {
                reproducirSonido('error');
                codigoCuponActivo = "";
                msgCupon.textContent = "❌ Código de cupón inválido o vencido.";
                msgCupon.className = "mensaje-cupon error";
            }
            actualizarCarritoVisual();
        });
    }

    if (selectEntrega) {
        selectEntrega.addEventListener('change', () => {
            const contenedorDireccion = document.getElementById('contenedor-direccion-envio');
            if (selectEntrega.value === "Envío a Domicilio (Zona Urbana)") {
                if (contenedorDireccion) contenedorDireccion.style.display = "block";
            } else {
                if (contenedorDireccion) contenedorDireccion.style.display = "none";
            }
            actualizarCarritoVisual();
            validarHorariosDisponibles();
        });
    }
}

function generarHTMLTarjeta(prod, esDestacada = false) {
    const itemEnCarrito = carrito.find(i => i.codigo === prod.codigo);
    const cantidadEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;
    
    const stockDisponible = Math.max(0, prod.stock - cantidadEnCarrito);
    const esAgotado = stockDisponible <= 0;
    
    let txtStock = `Disponibles: ${stockDisponible}`, cStock = 'producto-stock';
    if (prod.stock <= 0) { 
        txtStock = '❌ Agotado en Tienda'; cStock = 'producto-stock agotado'; 
    } else if (stockDisponible <= 0) {
        txtStock = '❌ Agotado en tu Carrito'; cStock = 'producto-stock agotado';
    } else if (stockDisponible <= 3) { 
        txtStock = `🔥 ¡Últimas ${stockDisponible} pzs!`; cStock = 'producto-stock stock-critico'; 
    }

    const arrImg = obtenerArregloImagenes(prod);
    let imgN = arrImg[0] ? arrImg[0].split(/[/\\\\]/).pop() : '';
    let rImg = imgN ? `imagenes_productos/${imgN}` : 'https://placehold.co/300?text=No+disponible';
    let img2N = arrImg.length > 1 ? arrImg[1].split(/[/\\\\]/).pop() : '';
    let rImg2 = img2N ? `imagenes_productos/${img2N}` : rImg;

    const artLimpio = prod.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const idImg = esDestacada ? `img-carrusel-dest-${prod.codigo}` : `img-carrusel-${prod.codigo}`;

    const bIzq = arrImg.length > 1 ? `<button class="carousel-btn left" onclick="moverImagenCarrusel('${prod.codigo}', -1); event.stopPropagation();">◀</button>` : '';
    const bDer = arrImg.length > 1 ? `<button class="carousel-btn right" onclick="moverImagenCarrusel('${prod.codigo}', 1); event.stopPropagation();">▶</button>` : '';
    const badgeDestacado = (!esDestacada && prod.destacado) ? `<div class="badge-destacado">OFERTA</div>` : '';
    const esFavorito = WISHLIST_GLOBAL.includes(prod.codigo) ? 'en-wishlist' : '';

    let botonFilaHTML = '';
    if (itemEnCarrito) {
        botonFilaHTML = `
        <div class="tarjeta-controles-qty">
            <button class="tarjeta-btn-qty" onclick="cambiarCantidad('${prod.codigo}', -1)">-</button>
            <span class="tarjeta-cant-num">${itemEnCarrito.cantidad} pzs</span>
            <button class="tarjeta-btn-qty" onclick="cambiarCantidad('${prod.codigo}', 1)" ${esAgotado ? 'disabled' : ''}>+</button>
        </div>`;
    } else {
        botonFilaHTML = `<button class="btn" onclick="agregarAlCarritoConEfecto('${prod.codigo}', this)" ${esAgotado ? 'disabled' : ''}>${esAgotado ? 'Sin existencias' : '🛒 Agregar'}</button>`;
    }

    return `
    <div class="producto-card">
        ${badgeDestacado}
        <button class="btn-wishlist ${esFavorito}" title="Guardar en Favoritos" onclick="alternarWishlist('${prod.codigo}')">❤️</button>
        <button class="btn-compartir" title="Compartir producto" onclick="compartirProducto('${prod.codigo}', '${artLimpio}', ${prod.precio})">🔗</button>
        <div>
            <div class="producto-codigo">CÓDIGO: ${prod.codigo}</div>
            <div class="img-wrapper" style="cursor: zoom-in;" onclick="abrirLightbox('${rImg}', '${artLimpio}')">
                ${bIzq} 
                <img id="${idImg}" src="${rImg}" alt="${artLimpio}" 
                     onmouseover="if('${rImg2}' !== '${rImg}') this.src='${rImg2}'"
                     onmouseout="this.src='${rImg}'"
                     onerror="this.onerror=null; this.src='https://placehold.co/300?text=${encodeURIComponent(artLimpio)}'"> 
                ${bDer}
            </div>
            <h3>${artLimpio}</h3>
            <div class="${cStock}">${txtStock}</div>
            <p style="color: var(--primary-light); font-weight: 700; font-size: 16px; margin: 0 0 6px 0;">${formatearDinero(prod.precio)}</p>
        </div>
        ${botonFilaHTML}
    </div>`;
}

// =========================================================================
// GESTIÓN DE CARRITO
// =========================================================================
window.agregarAlCarrito = function (codigo) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    if (!prod) return;
    
    const item = carrito.find(i => i.codigo === codigo);
    const cantidadActual = item ? item.cantidad : 0;
    
    if (prod.stock > cantidadActual) {
        reproducirSonido('agregar');
        if (item) item.cantidad += 1;
        else carrito.push({ codigo: codigo, cantidad: 1 });
        
        guardarCarritoEnLocalStorage();
        actualizarCarritoVisual();
        filtrarCatalogo();
        renderizarDestacados();
        renderizarWishlist();
        dispararAnimacionCarrito();
    } else {
        reproducirSonido('error');
        alert("Lo sentimos, ya no quedan más unidades disponibles en el inventario.");
    }
};

window.cambiarCantidad = function(codigo, cambio) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    const item = carrito.find(i => i.codigo === codigo);
    if (!item || !prod) return;

    if (cambio === 1) {
        if (prod.stock > item.cantidad) { 
            reproducirSonido('agregar');
            item.cantidad += 1; 
            dispararAnimacionCarrito(); 
        } else {
            reproducirSonido('error');
            alert("Lo sentimos, ya no quedan más unidades disponibles.");
        }
    } else if (cambio === -1) {
        reproducirSonido('eliminar');
        item.cantidad -= 1;
        if (item.cantidad <= 0) {
            const idx = carrito.findIndex(i => i.codigo === codigo);
            if (idx !== -1) carrito.splice(idx, 1);
        }
        dispararAnimacionCarrito();
    }
    
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();
    filtrarCatalogo();
    renderizarDestacados();
    renderizarWishlist();
};

function mostrarNotificacionFlotante(mensaje, duracion = 4000, colorFondo = '#2e1065') {
    const miniNotif = document.createElement('div');
    miniNotif.className = 'notificacion-carrito-guardado';
    miniNotif.style.bottom = '160px'; 
    miniNotif.style.background = colorFondo; 
    miniNotif.style.color = '#fff';
    miniNotif.style.border = '1px solid rgba(255,255,255,0.2)';
    miniNotif.style.zIndex = '9999';
    miniNotif.innerHTML = `<span>${mensaje}</span> <button class="btn-cerrar-notif" onclick="this.parentElement.remove()" style="color:white;">✕</button>`;
    document.body.appendChild(miniNotif);
    setTimeout(() => { if(miniNotif) miniNotif.remove(); }, duracion);
}

function verificarCarritoGuardadoAlEntrar() {
    if (carrito && carrito.length > 0) {
        const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
        mostrarNotificacionFlotante(`🛒 ¡Hola! Conservamos las <strong>${totalItems} pzs</strong> que dejaste en tu carrito anterior.`, 6000, '#2e1065');
    }
}

function lanzarEfectoConfeti() {
    if (typeof confetti === 'function') {
        confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } });
        confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } });
    }
}

function mostrarSkeletons() {
    const contenedor = document.getElementById('lista-productos');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        contenedor.innerHTML += `
        <div class="skeleton-card">
            <div class="skeleton-item skeleton-text-sm"></div>
            <div class="skeleton-item skeleton-img"></div>
            <div class="skeleton-item skeleton-text-md"></div>
            <div class="skeleton-item skeleton-text-sm" style="margin:0 auto;"></div>
            <div class="skeleton-item skeleton-text-lg"></div>
            <div class="skeleton-item skeleton-btn"></div>
        </div>`;
    }
}

function renderizarEventos() {
    const contenedor = document.getElementById('lista-eventos');
    const seccionEventos = document.getElementById('seccion-eventos');
    if (!contenedor || !seccionEventos) return;
    if (EVENTOS_CONFIG.length === 0) { seccionEventos.style.display = 'none'; return; }
    seccionEventos.style.display = 'block';
    contenedor.innerHTML = '';
    EVENTOS_CONFIG.forEach(evento => {
        const rutaImagen = evento.imagen ? evento.imagen : 'https://placehold.co/300x150?text=Evento';
        contenedor.innerHTML += `
        <div class="producto-card card-evento-interactiva" style="cursor: pointer;" onclick="filtrarPorEvento('${evento.categoriaVinculada}')">
            <div>
                <div class="producto-codigo">EVENTO ESPECIAL</div>
                <div class="img-wrapper" style="height: 115px;">
                    <img src="${rutaImagen}" alt="${evento.titulo}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.src='https://placehold.co/300x150?text=${encodeURIComponent(evento.titulo)}'">
                </div>
                <h3 style="font-size: 14px; margin: 8px 0 3px 0;">${evento.titulo}</h3>
                <div style="font-size: 11px; color: var(--primary-light); font-weight: bold; margin-bottom: 5px;">📅 ${evento.fecha}</div>
                <p style="font-size: 12px; color: var(--text-light); margin: 0 0 8px 0; line-height: 1.3; text-align: center;">${evento.descripcion}</p>
            </div>
            <div style="text-align: center; margin-top: auto; padding-top: 3px;">
                <span style="font-size: 11px; color: var(--primary-light); font-weight: bold; display: inline-block;">Ver productos ➔</span>
            </div>
        </div>`;
    });
}

function filtrarPorEvento(categoria) {
    if (!categoria) return;
    categorySeleccionada = categoria;
    document.querySelectorAll('.btn-categoria').forEach(btn => btn.classList.remove('activo'));
    document.querySelectorAll('.btn-categoria').forEach(btn => {
        if(btn.getAttribute('data-cat') && btn.getAttribute('data-cat').toLowerCase() === categoria.toLowerCase()) btn.classList.add('activo');
    });
    filtrarCatalogo();
    if (document.getElementById('buscador')) {
        const buscador = document.getElementById('buscador');
        buscador.value = "";
        buscador.placeholder = `🔍 Buscando eventos...`; 
    }
    if (document.getElementById('barra-categorias')) document.getElementById('barra-categorias').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function configurarTema() {
    const temaGuardado = localStorage.getItem('tema_tienda');
    const btnTema = document.getElementById('btn-tema');
    if (temaGuardado === 'light') { document.body.classList.add('light-mode'); if (btnTema) btnTema.innerText = '🌙'; }
    else { if (btnTema) btnTema.innerText = '☀️'; }
    if (btnTema) {
        btnTema.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const esClaro = document.body.classList.contains('light-mode');
            localStorage.setItem('tema_tienda', esClaro ? 'light' : 'dark');
            btnTema.innerText = esClaro ? '🌙' : '☀️';
        });
    }
}

function setupEventListeners() {
    document.getElementById('btn-vaciar').addEventListener('click', vaciarCarrito);
    document.getElementById('btn-enviar-pedido').addEventListener('click', enviarPedidoFinal);
    if (document.getElementById('btn-chat-manual')) document.getElementById('btn-chat-manual').addEventListener('click', abrirChatManual);
    if (document.getElementById('btn-enviar-pedido')) {
        document.getElementById('btn-enviar-pedido').addEventListener('dblclick', (e) => { e.preventDefault(); abrirModalDespacho(); });
    }
    document.querySelectorAll('.btn-categoria').forEach(button => {
        button.addEventListener('click', (e) => {
            seleccionarCategoria(e.currentTarget.getAttribute('data-cat'), e.currentTarget);
        });
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === "Escape") {
            const modalDespacho = document.getElementById('modal-despacho');
            if (modalDespacho) modalDespacho.style.display = 'none';
            if (typeof cerrarLightbox === 'function') cerrarLightbox();
        }
    });

    window.addEventListener('click', (e) => {
        const modalDespacho = document.getElementById('modal-despacho');
        if (e.target === modalDespacho) {
            modalDespacho.style.display = 'none';
        }
    });
}

function configuringCamposFecha() {
    const hoyObj = new Date();
    const hoy = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;
    const DIAS_FESTIVOS = ["2026-09-16", "2026-11-16", "2026-12-25"];
    const campoFecha = document.getElementById('fecha');
    if (campoFecha) {
        campoFecha.min = hoy;
        campoFecha.addEventListener('input', (e) => {
            const fechaSeleccionada = e.target.value;
            if (!fechaSeleccionada) return;
            if (DIAS_FESTIVOS.includes(fechaSeleccionada)) {
                reproducirSonido('error');
                alert("⚠️ Los días festivos oficiales no realizamos entregas. Por favor selecciona otro día.");
                e.target.value = '';
                return;
            }
            const fechaObj = new Date(fechaSeleccionada + 'T00:00:00');
            if (fechaObj.getDay() === 0 || fechaObj.getDay() === 6) {
                reproducirSonido('error');
                alert("⚠️ Los fines de semana no realizamos entregas. Selecciona de Lunes a Viernes.");
                e.target.value = '';
                return;
            }
            validarHorariosDisponibles(); 
        });
    }
    const campoHora = document.getElementById('hora');
    if(campoHora) campoHora.addEventListener('focus', validarHorariosDisponibles);
}

// =========================================================================
// VALIDAR HORARIOS DISPONIBLES
// =========================================================================
function validarHorariosDisponibles() {
    const campoFecha = document.getElementById('fecha');
    const campoHora = document.getElementById('hora');
    const selectEntrega = document.getElementById('select-punto-entrega');
    if (!campoFecha || !campoHora) return;

    const fechaSeleccionada = campoFecha.value;
    const ahora = new Date();
    const hoyStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const valorPreseleccion = campoHora.value;
    const esEnvio = selectEntrega && selectEntrega.value === "Envío a Domicilio (Zona Urbana)";

    campoHora.innerHTML = '';

    if (esEnvio) {
        let incluirEnvio = true;
        if (fechaSeleccionada === hoyStr) {
            const horaActual = ahora.getHours();
            const minActual = ahora.getMinutes();
            if (horaActual > 16 || (horaActual === 16 && minActual > 15)) {
                incluirEnvio = false;
            }
        }
        
        if (incluirEnvio) {
            const opt = document.createElement('option');
            opt.value = "16:00";
            opt.innerText = "4 pm a 5 pm (Rango único de entrega)";
            campoHora.appendChild(opt);
        } else {
            const opt = document.createElement('option');
            opt.value = "";
            opt.innerText = "❌ Horario fuera de límite por hoy (Solicitar para mañana)";
            campoHora.appendChild(opt);
        }
        return;
    }

    // Adaptación para mantener el horario ajustado 
    let incluirEnvioFisica = true;
    if (fechaSeleccionada === hoyStr) {
        const horaActual = ahora.getHours();
        const minActual = ahora.getMinutes();
        if (horaActual > 16 || (horaActual === 16 && minActual > 15)) {
            incluirEnvioFisica = false;
        }
    }
    if (incluirEnvioFisica) {
        const opt = document.createElement('option');
        opt.value = "16:00";
        opt.innerText = "4 pm a 5 pm (Rango único de entrega)";
        campoHora.appendChild(opt);
    } else {
        const opt = document.createElement('option');
        opt.value = "";
        opt.innerText = "❌ Horario fuera de límite por hoy (Solicitar para mañana)";
        campoHora.appendChild(opt);
    }
}

function formatearDinero(numero) {
    let num = parseFloat(numero);
    return '$' + (isNaN(num) ? 0 : num).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

function formatearFechaHumana(fechaISO) {
    if (!fechaISO) return "";
    const partes = fechaISO.split('-');
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${partes[2]} de ${meses[parseInt(partes[1]) - 1]} de ${partes[0]}`;
}

function guardarCarritoEnLocalStorage() { localStorage.setItem('carrito_tienda', JSON.stringify(carrito)); }
function recuperarCarritoDeLocalStorage() { const guardado = localStorage.getItem('carrito_tienda'); if (guardado) carrito = JSON.parse(guardado); }

function actualizarContadoresCategorias() {
    const conteo = { todas: INVENTARIO_GLOBAL.length };
    INVENTARIO_GLOBAL.forEach(prod => {
        const cat = prod.categoria ? prod.categoria.toLowerCase() : "general";
        conteo[cat] = (conteo[cat] || 0) + 1;
    });
    document.querySelectorAll('.btn-categoria').forEach(btn => {
        const catId = btn.getAttribute('data-cat').toLowerCase();
        const contadorViejo = btn.querySelector('.cat-contador');
        if (contadorViejo) contadorViejo.remove();
        const num = conteo[catId] || 0;
        const spanContador = document.createElement('span');
        spanContador.className = 'cat-contador';
        spanContador.innerText = num;
        btn.appendChild(spanContador);
    });
}

function obtenerArregloImagenes(prod) {
    if (!prod.imagen) return [];
    return prod.imagen.includes(',') ? prod.imagen.split(',').map(img => img.trim()) : [prod.imagen];
}

window.moverImagenCarrusel = function (codigo, direccion) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    if (!prod) return;
    const images = obtenerArregloImagenes(prod);
    if (images.length <= 1) return;
    if (indicesCarrusel[codigo] === undefined) indicesCarrusel[codigo] = 0;
    indicesCarrusel[codigo] += direccion;
    if (indicesCarrusel[codigo] >= images.length) indicesCarrusel[codigo] = 0;
    else if (indicesCarrusel[codigo] < 0) indicesCarrusel[codigo] = images.length - 1;
    let imgName = images[indicesCarrusel[codigo]].split(/[/\\\\]/).pop();
    let nRuta = imgName ? `imagenes_productos/${imgName}` : 'https://placehold.co/300';
    if (document.getElementById(`img-carrusel-${codigo}`)) document.getElementById(`img-carrusel-${codigo}`).src = nRuta;
    if (document.getElementById(`img-carrusel-dest-${codigo}`)) document.getElementById(`img-carrusel-dest-${codigo}`).src = nRuta;
};

window.compartirProducto = function(codigo, nombre, precio) {
    const urlBase = window.location.origin + window.location.pathname;
    const enlaceWebProducto = `${urlBase}?prod=${encodeURIComponent(codigo)}`;
    const txt = `*¡Mira este producto en Tienda DAYH!* 🤩\n\n🛍️ *${nombre}*\n📌 Código: ${codigo}\n💰 Precio: ${formatearDinero(precio)}\n\n👇 Ver detalles y agregarlo al carrito aquí:\n${enlaceWebProducto}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
};

window.alternarWishlist = function(codigo) {
    const index = WISHLIST_GLOBAL.indexOf(codigo);
    if (index === -1) WISHLIST_GLOBAL.push(codigo);
    else WISHLIST_GLOBAL.splice(index, 1);
    localStorage.setItem('wishlist_tienda', JSON.stringify(WISHLIST_GLOBAL));
    filtrarCatalogo();
    renderizarDestacados();
    renderizarWishlist();
};

function renderizarWishlist() {
    const cont = document.getElementById('lista-wishlist');
    const sec = document.getElementById('seccion-wishlist');
    const badge = document.getElementById('badge-wishlist');
    if (!cont || !sec) return;
    if (badge) badge.innerText = WISHLIST_GLOBAL.length;
    if (WISHLIST_GLOBAL.length === 0) { sec.style.display = 'none'; return; }
    sec.style.display = 'block'; cont.innerHTML = '';
    WISHLIST_GLOBAL.forEach(codigo => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
        if (prod) cont.innerHTML += generarHTMLTarjeta(prod, true);
    });
}

function recuperarWishlistDeLocalStorage() {
    const guardado = localStorage.getItem('wishlist_tienda');
    if (guardado) WISHLIST_GLOBAL = JSON.parse(guardado);
}

function renderizarDestacados() {
    const cont = document.getElementById('lista-destacados');
    const sec = document.getElementById('seccion-destacados');
    if (!cont || !sec) return;
    const dest = INVENTARIO_GLOBAL.filter(p => p.destacado === true);
    if (dest.length === 0) { sec.style.display = 'none'; return; }
    sec.style.display = 'block'; cont.innerHTML = '';
    dest.forEach(p => { cont.innerHTML += generarHTMLTarjeta(p, true); });
}

function filtrarCatalogo() {
    const buscador = document.getElementById('buscador');
    const buscar = buscador ? buscador.value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
    const filtrados = INVENTARIO_GLOBAL.filter(prod => {
        const nom = prod.articulo ? prod.articulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
        const cod = prod.codigo ? prod.codigo.toLowerCase() : "";
        const cat = prod.categoria ? prod.categoria.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "general";
        return (nom.includes(buscar) || cod.includes(buscar)) && (categorySeleccionada === "todas" || cat === categorySeleccionada.toLowerCase());
    });
    const cont = document.getElementById('lista-productos');
    if (!cont) return; cont.innerHTML = '';
    if (filtrados.length === 0) { cont.innerHTML = '<p class="sin-resultados">No encontramos productos.</p>'; return; }
    filtrados.forEach(p => { cont.innerHTML += generarHTMLTarjeta(p, false); });
}

function seleccionarCategoria(cat, elemento) {
    categorySeleccionada = cat;
    document.querySelectorAll('.btn-categoria').forEach(b => b.classList.remove('activo'));
    if (elemento) elemento.classList.add('activo');
    if (document.getElementById('buscador')) {
        document.getElementById('buscador').placeholder = cat === 'todas' 
            ? " 🔍 ¿Qué estás buscando hoy? Escribe nombre o código..." 
            : `🔍 Buscando en ${cat}...`;
    }
    filtrarCatalogo();
}

function dispararAnimacionCarrito() {
    const elements = [document.getElementById('badge-contador'), document.getElementById('carrito-flotante')];
    elements.forEach(el => {
        if(el) {
            el.classList.remove('animar-pop', 'animar-shake');
            void el.offsetWidth; 
            if (el.id === 'carrito-flotante') el.classList.add('animar-shake');
            else el.classList.add('animar-pop');
        }
    });
}

window.agregarAlCarritoConEfecto = function(codigo, botonElement) {
    agregarAlCarrito(codigo);
    if (botonElement && !botonElement.disabled) {
        crearEfectoVolador(botonElement);
        const textoOriginal = botonElement.innerHTML;
        botonElement.disabled = true;
        botonElement.style.background = "var(--success)";
        botonElement.style.boxShadow = "0 0 15px rgba(16, 185, 129, 0.5)";
        botonElement.innerHTML = "¡Añadido! ✓";
        setTimeout(() => {
            botonElement.disabled = false;
            botonElement.style.background = "";
            botonElement.style.boxShadow = "";
            botonElement.innerHTML = textoOriginal;
        }, 1200);
    }
};

function crearEfectoVolador(elementoOrigen) {
    const destino = document.getElementById('carrito-flotante') || document.querySelector('.carrito');
    if (!elementoOrigen || !destino) return;
    const rectOrigen = elementoOrigen.getBoundingClientRect();
    const rectDestino = destino.getBoundingClientRect();
    const particula = document.createElement('div');
    particula.className = 'particula-voladora';
    particula.innerHTML = '🎁';
    particula.style.left = `${rectOrigen.left + rectOrigen.width / 2 - 15}px`;
    particula.style.top = `${rectOrigen.top + rectOrigen.height / 2 - 15}px`;
    document.body.appendChild(particula);
    setTimeout(() => {
        particula.style.left = `${rectDestino.left + rectDestino.width / 2 - 15}px`;
        particula.style.top = `${rectDestino.top + rectDestino.height / 2 - 15}px`;
        particula.style.transform = 'scale(0.4)';
        particula.style.opacity = '0.5';
    }, 50);
    setTimeout(() => { particula.remove(); }, 650);
}

function vaciarCarrito() {
    if (confirm("¿Estás seguro de vaciar el pedido?")) {
        reproducirSonido('eliminar');
        carrito = [];
        codigoCuponActivo = "";
        yaExplotoConfettiEnvio = false; 
        const msgCupon = document.getElementById('mensaje-cupon');
        const inputCupon = document.getElementById('input-cupon');
        if(msgCupon) msgCupon.textContent = "";
        if(inputCupon) inputCupon.value = "";
        
        guardarCarritoEnLocalStorage();
        localStorage.removeItem('inventario_tienda_real');
        cargarProductos();
    }
}

// =========================================================================
// ACTUALIZAR CARRITO VISUAL
// =========================================================================
function actualizarCarritoVisual() {
    const cont = document.getElementById('items-carrito');
    const txtMonto = document.getElementById('total-monto');
    const btnVaciar = document.getElementById('btn-vaciar');
    const bContador = document.getElementById('badge-contador');
    const bFlotante = document.getElementById('badge-flotante');
    
    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    if (bContador) bContador.innerText = totalItems;
    if (bFlotante) bFlotante.innerText = totalItems;

    const infoEnvioGratis = document.getElementById('info-envio-gratis');
    const contenedorDireccion = document.getElementById('contenedor-direccion-envio');
    const campoFecha = document.getElementById('fecha');
    const campoHora = document.getElementById('hora');
    const puntoEntrega = document.getElementById('select-punto-entrega');

    if (carrito.length === 0) {
        yaExplotoConfettiEnvio = false; 
        if (cont) {
            cont.innerHTML = '<p style="color: var(--text-light); text-align: center; margin: 20px 0; font-size: 14px;">Tu carrito está vacío.</p>';
        }
        if (txtMonto) txtMonto.innerText = "$0.00";
        if (btnVaciar) btnVaciar.style.display = 'none';
        
        document.getElementById('resumen-subtotal').innerText = "$0.00";
        document.getElementById('fila-descuento').style.display = "none";
        document.getElementById('fila-envio').style.display = "none";
        if (infoEnvioGratis) infoEnvioGratis.style.display = "none";
        if (contenedorDireccion) contenedorDireccion.style.display = "none";
        
        if (campoFecha) { 
            campoFecha.disabled = false; 
            campoFecha.style.opacity = "1"; 
            campoFecha.value = "";
        }
        if (campoHora) {
            campoHora.disabled = false;
            campoHora.style.opacity = "1";
        }
        
        const contenedorCross = document.querySelector('.contenedor-cross-selling');
        if (contenedorCross) contenedorCross.style.display = 'none';
        
        if (puntoEntrega) {
            puntoEntrega.innerHTML = `<option value="" disabled selected>-- Selecciona dónde recibir --</option>
                                      <option value="TIENDA DAHY (Entrega Física)">TIENDA DAHY (Entrega Física) - Gratis</option>`;
        }
        return;
    }

    if (btnVaciar) btnVaciar.style.display = 'block';

    let subtotalGeneral = 0;
    let montoDescuento = 0;
    let configCupon = codigoCuponActivo ? CUPONES_CONFIG[codigoCuponActivo] : null;

    if (cont) cont.innerHTML = '';

    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;

        const subtotalProducto = prod.precio * item.cantidad;
        subtotalGeneral += subtotalProducto;

        if (configCupon) {
            const catProd = prod.categoria ? prod.categoria.toLowerCase() : "general";
            if (!configCupon.categoriaRestringida || catProd === configCupon.categoriaRestringida.toLowerCase()) {
                montoDescuento += subtotalProducto * configCupon.descuento;
            }
        }

        const arrImg = obtenerArregloImagenes(prod);
        let imgNombre = arrImg[0] ? arrImg[0].split(/[/\\\\]/).pop() : '';
        let rutaImagen = imgNombre ? `imagenes_productos/${imgNombre}` : 'https://placehold.co/50x50?text=Prod';
        const artLimpio = prod.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const itemHTML = `
            <div class="item-carrito" style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border);">
                
                <img src="${rutaImagen}" alt="${artLimpio}" 
                     style="width: 50px; height: 50px; object-fit: contain; border-radius: 8px; background: #fff; border: 1px solid var(--border); padding: 2px;"
                     onerror="this.onerror=null; this.src='https://placehold.co/50x50?text=DAYH';">
                
                <div class="info-item-carrito" style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 3px 0; font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--text);">${artLimpio}</h4>
                    <span style="font-size: 12px; color: var(--primary-light); font-weight: bold;">${formatearDinero(prod.precio)}</span>
                    
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">
                        <button onclick="cambiarCantidad('${prod.codigo}', -1)" style="padding: 1px 6px; cursor: pointer; background: var(--card-bg); border: 1px solid var(--border); color: white; border-radius: 4px; font-weight: bold;">-</button>
                        <span style="font-size: 12px; font-weight: 600; color: var(--text); min-width: 14px; text-align: center;">${item.cantidad}</span>
                        <button onclick="cambiarCantidad('${prod.codigo}', 1)" style="padding: 1px 6px; cursor: pointer; background: var(--card-bg); border: 1px solid var(--border); color: white; border-radius: 4px; font-weight: bold;">+</button>
                    </div>
                </div>

                <div style="text-align: right; min-width: 70px;">
                    <div style="font-size: 13px; font-weight: bold; color: var(--text); margin-bottom: 4px;">${formatearDinero(subtotalProducto)}</div>
                    <button onclick="eliminarDelCarritoVisual('${prod.codigo}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 13px; padding: 2px;" title="Eliminar artículo">🗑️</button>
                </div>
            </div>
        `;
        
        if (cont) cont.innerHTML += itemHTML;
    });

    if (subtotalGeneral >= 500 && !localStorage.getItem('cupon_recompensa_visto')) {
        mostrarNotificacionFlotante("🎉 ¡Desbloqueaste el cupón EXTRA5! Aplícalo para obtener un 5% adicional.", 8000, '#10b981');
        CUPONES_CONFIG["EXTRA5"] = { descuento: 0.05, categoriaRestringida: null };
        localStorage.setItem('cupon_recompensa_visto', 'true');
    }

    const metaEnvio = 150.00;
    const alcanzoEnvioGratis = subtotalGeneral >= metaEnvio;

    if (alcanzoEnvioGratis && !yaExplotoConfettiEnvio) {
        lanzarEfectoConfeti();
        yaExplotoConfettiEnvio = true; 
    } else if (!alcanzoEnvioGratis) {
        yaExplotoConfettiEnvio = false; 
    }

    if (infoEnvioGratis) {
        infoEnvioGratis.style.display = "block";
        if (alcanzoEnvioGratis) {
            infoEnvioGratis.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--success); color: var(--success); padding: 12px; border-radius: 8px; text-align: center; margin-bottom: 15px; line-height: 1.4;">
                    <strong>🎉 ¡Felicidades! Desbloqueaste la opción de Envío a Domicilio GRATIS.</strong><br>
                    <span style="font-size: 12px; opacity: 0.9;">Ya puedes seleccionar "Envío a Domicilio" en el menú inferior.</span>
                </div>`;
        } else {
            const cuantoFalta = metaEnvio - subtotalGeneral;
            const porcentajeProgreso = Math.min((subtotalGeneral / metaEnvio) * 100, 100);
            
            const complementosDisponibles = INVENTARIO_GLOBAL.filter(p => p.stock > 0 && p.precio <= 50 && !carrito.some(item => item.codigo === p.codigo));
            let htmlEmpujoncito = '';

            if (complementosDisponibles.length > 0) {
                const sugerido = complementosDisponibles[0];
                const arrImgSugerido = obtenerArregloImagenes(sugerido);
                let imgSugeridoName = arrImgSugerido[0] ? arrImgSugerido[0].split(/[/\\\\]/).pop() : '';
                let rImgSugerido = imgSugeridoName ? `imagenes_productos/${imgSugeridoName}` : 'https://placehold.co/35x35?text=DAYH';

                htmlEmpujoncito = `
                <div style="margin-top: 10px; background: rgba(168, 85, 247, 0.08); border: 1px dashed rgba(168, 85, 247, 0.3); border-radius: 6px; padding: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <img src="${rImgSugerido}" alt="${sugerido.articulo}" style="width: 30px; height: 30px; object-fit: contain; background: white; border-radius: 4px; border: 1px solid var(--border);">
                        <div style="font-size: 11px; line-height: 1.2;">
                            <span style="color: var(--text-light); display: block;">💡 Agrega esto para completar el envío:</span>
                            <strong style="color: var(--text);">${sugerido.articulo.substring(0, 22)}... (${formatearDinero(sugerido.precio)})</strong>
                        </div>
                    </div>
                    <button class="btn" style="padding: 4px 8px; font-size: 10px; margin: 0; width: auto;" onclick="agregarAlCarrito('${sugerido.codigo}')">+ Añadir</button>
                </div>`;
            }

            infoEnvioGratis.innerHTML = `
                <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="font-size: 12px; color: var(--text-light); margin-bottom: 6px; display: flex; justify-content: space-between;">
                        <span>Compra <strong>${formatearDinero(cuantoFalta)}</strong> más para habilitar Envío a Domicilio GRATIS</span>
                        <span>${porcentajeProgreso.toFixed(0)}%</span>
                    </div>
                    <div style="background: var(--border); height: 6px; border-radius: 4px; overflow: hidden;">
                        <div style="background: var(--primary); width: ${porcentajeProgreso}%; height: 100%; transition: width 0.3s ease;"></div>
                    </div>
                    ${htmlEmpujoncito}
                </div>`;
        }
    }

    const valorSeleccionadoPrevio = puntoEntrega ? puntoEntrega.value : "";
    
    if (puntoEntrega) {
        puntoEntrega.innerHTML = `<option value="" disabled>-- Selecciona dónde recibir --</option>`;
        puntoEntrega.innerHTML += `<option value="TIENDA DAHY (Entrega Física)">TIENDA DAHY (Entrega Física) - Gratis</option>`;

        if (alcanzoEnvioGratis) {
            puntoEntrega.innerHTML += `<option value="Envío a Domicilio (Zona Urbana)">Envío a Domicilio (¡GRATIS!)</option>`;
        }

        if (valorSeleccionadoPrevio && Array.from(puntoEntrega.options).some(o => o.value === valorSeleccionadoPrevio)) {
            puntoEntrega.value = valorSeleccionadoPrevio;
        } else {
            puntoEntrega.value = "TIENDA DAHY (Entrega Física)";
        }
    }

    cargoPorEnvio = 0;

    const opcionElegida = puntoEntrega ? puntoEntrega.value : "";
    if (opcionElegida === "Envío a Domicilio (Zona Urbana)") {
        if (contenedorDireccion) contenedorDireccion.style.display = "block";
    } else {
        if (contenedorDireccion) contenedorDireccion.style.display = "none";
    }

    if (campoFecha) { campoFecha.disabled = false; campoFecha.style.opacity = "1"; }
    if (campoHora) { campoHora.disabled = false; campoHora.style.opacity = "1"; }

    let totalFinal = Math.max(0, subtotalGeneral - montoDescuento);

    document.getElementById('resumen-subtotal').innerText = formatearDinero(subtotalGeneral);

    const filaDescuento = document.getElementById('fila-descuento');
    const resumenDescuento = document.getElementById('resumen-descuento');
    if (filaDescuento && resumenDescuento) {
        if (montoDescuento > 0) {
            filaDescuento.style.display = "flex";
            resumenDescuento.innerText = `-${formatearDinero(montoDescuento)}`;
        } else {
            filaDescuento.style.display = "none";
        }
    }

    const filaEnvio = document.getElementById('fila-envio');
    const resumenEnvio = document.getElementById('resumen-envio');
    if (filaEnvio && resumenEnvio) {
        filaEnvio.style.display = "flex";
        resumenEnvio.innerText = "¡Gratis! 🎉";
        resumenEnvio.style.color = "var(--success)";
    }

    if (txtMonto) txtMonto.innerText = formatearDinero(totalFinal);
    renderizarCrossSelling();
}

function eliminarDelCarritoVisual(codigo) {
    reproducirSonido('eliminar');
    carrito = carrito.filter(item => item.codigo !== codigo);
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();
    filtrarCatalogo();
    renderizarDestacados();
    renderizarWishlist();
}

function renderizarCrossSelling() {
    let contenedorCross = document.querySelector('.contenedor-cross-selling');
    if (!contenedorCross) return;

    const codigosEnCarrito = carrito.map(item => item.codigo);
    const sugeridos = INVENTARIO_GLOBAL.filter(p => p.stock > 0 && !codigosEnCarrito.includes(p.codigo))
                                      .slice(0, 2);

    if (sugeridos.length === 0) {
        contenedorCross.style.display = 'none';
        return;
    }

    contenedorCross.style.display = 'block';
    contenedorCross.innerHTML = `
        <h4 class="titulo-cross">✨ Te podría interesar para tu pedido:</h4>
        <div class="productos-cross-grid">
            ${sugeridos.map(p => {
                const arrImg = obtenerArregloImagenes(p);
                let imgN = arrImg[0] ? arrImg[0].split(/[/\\\\]/).pop() : '';
                let rImg = imgN ? `imagenes_productos/${imgN}` : 'https://placehold.co/50x50?text=Prod';
                const artLimpio = p.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                
                return `
                <div class="tarjeta-cross">
                    <img src="${rImg}" alt="${artLimpio}" onerror="this.src='https://placehold.co/50x50?text=Prod'">
                    <div class="info-cross">
                        <strong style="font-size: 12px; display: block;" title="${artLimpio}">${artLimpio}</strong>
                        <span style="color: var(--primary-light); font-size: 11px;">$${p.precio.toFixed(2)}</span>
                    </div>
                    <button class="btn" style="padding: 4px 10px; font-size: 11px; margin: 0; width: auto;" 
                            onclick="agregarAlCarrito('${p.codigo}')">
                        + Añadir
                    </button>
                </div>`;
            }).join('')}
        </div>
    `;
}

async function enviarPedidoFinal() {
    if (carrito.length === 0) { 
        reproducirSonido('error');
        alert("Tu carrito está vacío"); 
        return; 
    }
    
    const puntoEntrega = document.getElementById('select-punto-entrega');
    const valorPuntoEntrega = puntoEntrega ? puntoEntrega.value : "";
    
    if (!valorPuntoEntrega) {
        reproducirSonido('error');
        alert("Por favor, selecciona tu Punto de Entrega o Sucursal antes de continuar.");
        return;
    }

    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora').value;
    const cliente = document.getElementById('cliente').value.trim();
    const metodoPago = document.getElementById('metodo-pago') ? document.getElementById('metodo-pago').value : "No especificado";
    const direccionEnvio = document.getElementById('direccion-envio') ? document.getElementById('direccion-envio').value.trim() : "";

    if (valorPuntoEntrega === "Envío a Domicilio (Zona Urbana)" && direccionEnvio.length < 5) {
        reproducirSonido('error');
        alert("Por favor, escribe la dirección completa donde se realizará el envío.");
        return;
    }

    if (!fecha || !hora || cliente.length < 3) { 
        reproducirSonido('error');
        alert("Por favor completa los campos: Fecha, Hora y Nombre Completo."); 
        return; 
    }

    const btnEnviar = document.getElementById('btn-enviar-pedido');
    const textoOriginal = btnEnviar.innerText;
    btnEnviar.innerText = "Procesando pedido...";
    btnEnviar.disabled = true;

    try {
        let subtotalProductos = 0;
        let montoDescuento = 0;
        const configCupon = CUPONES_CONFIG[codigoCuponActivo] || null;
        const productosParaAPI = [];

        let textoMensajeWhatsApp = `*¡Hola Tienda DAYH! Generé un nuevo pedido* 📄🛒\n\n`;
        textoMensajeWhatsApp += `👤 *Cliente:* ${cliente}\n`;
        textoMensajeWhatsApp += `📍 *Punto/Entrega:* ${valorPuntoEntrega}\n`;
        
        if (valorPuntoEntrega === "Envío a Domicilio (Zona Urbana)") {
            textoMensajeWhatsApp += `🏠 *Dirección de Envío:* ${direccionEnvio}\n`;
        }

        textoMensajeWhatsApp += `📅 *Fecha de Entrega:* ${formatearFechaHumana(fecha)}\n`;
        textoMensajeWhatsApp += `⏰ *Hora Aproximada:* ${hora === '16:00' ? '4 pm a 5 pm' : hora}\n`;
        textoMensajeWhatsApp += `💳 *Forma de Pago:* ${metodoPago}\n`;
        if (codigoCuponActivo) {
            textoMensajeWhatsApp += `🎟️ *Cupón Aplicado:* ${codigoCuponActivo}\n`;
        }
        textoMensajeWhatsApp += `\n📦 *DETALLE DEL PEDIDO:*\n`;

        carrito.forEach(item => {
            const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
            if (prod) {
                const sub = prod.precio * item.cantidad;
                subtotalProductos += sub;
                
                if (configCupon) {
                    const catProd = prod.categoria ? prod.categoria.toLowerCase() : "general";
                    if (!configCupon.categoriaRestringida || catProd === configCupon.categoriaRestringida.toLowerCase()) {
                        montoDescuento += sub * configCupon.descuento;
                    }
                }

                textoMensajeWhatsApp += `▪️ ${item.cantidad}x [${prod.codigo}] ${prod.articulo} - _${formatearDinero(sub)}_\n`;
                productosParaAPI.push({ codigo: item.codigo, cantidad: item.cantidad });
            }
        });

        let totalGeneral = subtotalProductos - montoDescuento;

        if (window.jspdf) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFillColor(168, 85, 247); doc.rect(0, 0, 210, 35, "F");
            doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("TIENDA DAYH", 15, 18);
            doc.setFont("helvetica", "italic"); doc.setFontSize(10); doc.text("Tu catálogo de confianza — Comprobante Oficial de Pedido", 15, 26);
            doc.setTextColor(17, 24, 39); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("DATOS DEL CLIENTE Y LOGÍSTICA", 15, 48);
            doc.setDrawColor(192, 132, 252); doc.setLineWidth(0.5); doc.line(15, 51, 95, 51);
            doc.setFont("helvetica", "bold"); doc.text("Nombre Completo:", 15, 59); doc.setFont("helvetica", "normal"); doc.text(cliente, 55, 59);
            doc.setFont("helvetica", "bold"); doc.text("Punto Entrega:", 15, 66); doc.setFont("helvetica", "normal"); doc.text(valorPuntoEntrega, 55, 66);
            
            let compensacionY = 0;
            if (valorPuntoEntrega === "Envío a Domicilio (Zona Urbana)") {
                doc.setFont("helvetica", "bold"); doc.text("Dirección Envío:", 15, 73); doc.setFont("helvetica", "normal"); doc.text(direccionEnvio, 55, 73);
                compensacionY = 7;
            }

            doc.setFont("helvetica", "bold"); doc.text("Fecha de Entrega:", 15, 73 + compensacionY); doc.setFont("helvetica", "normal"); doc.text(formatearFechaHumana(fecha), 55, 73 + compensacionY);
            doc.setFont("helvetica", "bold"); doc.text("Hora Aproximada:", 15, 80 + compensacionY); doc.setFont("helvetica", "normal"); doc.text(hora === '16:00' ? '4 pm a 5 pm' : hora, 55, 80 + compensacionY);
            doc.setFont("helvetica", "bold"); doc.text("Método de Pago:", 15, 87 + compensacionY); doc.setFont("helvetica", "normal"); doc.text(metodoPago, 55, 87 + compensacionY);
            doc.setFont("helvetica", "bold"); doc.text("DETALLE DEL PEDIDO", 15, 100 + compensacionY); doc.line(15, 103 + compensacionY, 195, 103 + compensacionY);
            doc.setFillColor(249, 250, 251); doc.rect(15, 107 + compensacionY, 180, 8, "F");
            doc.setFontSize(10); doc.text("Cant.", 18, 112 + compensacionY); doc.text("Código", 35, 112 + compensacionY); doc.text("Descripción del Artículo", 65, 112 + compensacionY); doc.text("Subtotal", 172, 112 + compensacionY);
            doc.setDrawColor(229, 231, 235); doc.line(15, 115 + compensacionY, 195, 115 + compensacionY);

            let yPosition = 123 + compensacionY; doc.setFont("helvetica", "normal");
            
            carrito.forEach((item, index) => {
                const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
                if (!prod) return;
                const subtotal = prod.precio * item.cantidad;
                if (yPosition > 270) {
                    doc.addPage(); yPosition = 25; 
                    doc.setFont("helvetica", "bold"); doc.setFillColor(249, 250, 251); doc.rect(15, yPosition - 5, 180, 8, "F");
                    doc.text("Cant.", 18, yPosition); doc.text("Código", 35, yPosition); doc.text("Descripción del Artículo", 65, yPosition); doc.text("Subtotal", 172, yPosition);
                    yPosition += 12; doc.setFont("helvetica", "normal");
                }
                if (index % 2 === 0) { doc.setFillColor(253, 244, 255); doc.rect(15, yPosition - 5, 180, 8, "F"); }
                doc.text(`${item.cantidad}x`, 18, yPosition); doc.text(prod.codigo, 35, yPosition);
                const itemNombre = prod.articulo.length > 40 ? prod.articulo.substring(0, 37) + "..." : prod.articulo;
                doc.text(itemNombre, 65, yPosition); doc.text(formatearDinero(subtotal), 172, yPosition);
                yPosition += 8;
            });

            doc.setDrawColor(168, 85, 247); doc.setLineWidth(1); doc.line(15, yPosition, 195, yPosition);
            
            yPosition += 8;
            if (montoDescuento > 0) {
                doc.setFontSize(10);
                doc.text("Subtotal:", 145, yPosition); doc.text(formatearDinero(subtotalProductos), 172, yPosition);
                yPosition += 6;
                doc.text("Descuento:", 145, yPosition); doc.text(`-${formatearDinero(montoDescuento)}`, 172, yPosition);
                yPosition += 8;
            }

            doc.setFillColor(243, 232, 255); doc.rect(120, yPosition - 6, 75, 10, "F");
            doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(107, 33, 168); 
            doc.text("TOTAL A PAGAR:", 125, yPosition); doc.text(formatearDinero(totalGeneral), 172, yPosition);
            doc.setTextColor(156, 163, 175); doc.setFontSize(9); doc.setFont("helvetica", "italic");
            doc.text("Gracias por tu preferencia. Conserva este PDF como tu comprobante de compra.", 15, yPosition + 15);
            const safeName = cliente.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`Pedido_${safeName}_${fecha}.pdf`);
        }

        textoMensajeWhatsApp += `\n--------------------------------------\n`;
        textoMensajeWhatsApp += `💰 *Subtotal:* ${formatearDinero(subtotalProductos)}\n`;
        if (montoDescuento > 0) {
            textoMensajeWhatsApp += `📉 *Descuento:* -${formatearDinero(montoDescuento)}\n`;
        }
        textoMensajeWhatsApp += `📦 *Costo de Envío:* ¡GRATIS! 🎉\n`;
        textoMensajeWhatsApp += `💵 *TOTAL NETO A PAGAR: ${formatearDinero(totalGeneral)}*\n\n`;
        
        if (window.jspdf) textoMensajeWhatsApp += `⚠️ _Nota: Ya he descargado mi comprobante oficial en formato PDF en mi dispositivo._`;

        const response = await fetch(`${BACKEND_URL}/api/pedidos`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ cliente: cliente, fecha_entrega: fecha, hora_entrega: hora, productos: productosParaAPI, metodo_pago: metodoPago, direccion: direccionEnvio }) 
        });

        reproducirSonido('pedido');
        lanzarEfectoConfeti();
        carrito = [];
        codigoCuponActivo = "";
        yaExplotoConfettiEnvio = false;
        if(document.getElementById('input-cupon')) document.getElementById('input-cupon').value = "";
        if(document.getElementById('mensaje-cupon')) document.getElementById('mensaje-cupon').textContent = "";
        if(document.getElementById('direccion-envio')) document.getElementById('direccion-envio').value = "";
        
        guardarCarritoEnLocalStorage();
        actualizarCarritoVisual();
        actualizarContadoresCategorias();
        filtrarCatalogo(); 
        renderizarDestacados();
        renderizarWishlist();

        localStorage.setItem("nombre_cliente_dayh", cliente);
        if (document.getElementById("fecha")) document.getElementById("fecha").value = "";
        if (document.getElementById("hora")) document.getElementById("hora").value = "";

        const numeroDestino = typeof TELEFONO_WHATSAPP !== 'undefined' ? TELEFONO_WHATSAPP : "527442411773";
        window.open(`https://wa.me/${numeroDestino}?text=${encodeURIComponent(textoMensajeWhatsApp)}`, '_blank');

        if (document.getElementById('alerta-copiado')) {
            const alerta = document.getElementById('alerta-copiado');
            alerta.innerText = "¡PDF generado y pedido sincronizado! 📄📱";
            alerta.style.display = 'block';
        }

    } catch (err) {
        console.error("Error al sincronizar el pedido:", err);
        reproducirSonido('error');
        alert("Hubo un problema al registrar el pedido en el servidor. Por favor, reintenta.");
    } finally {
        btnEnviar.innerText = textoOriginal;
        btnEnviar.disabled = false;
    }
}

function abrirChatManual() { if (urlGlobalWhatsApp) window.open(urlGlobalWhatsApp, '_blank'); }

function abrirModalDespacho() {
    if (carrito.length === 0) { alert("El carrito está vacío."); return; }
    const cont = document.getElementById('detalle-despacho-productos');
    const modal = document.getElementById('modal-despacho');
    if (!cont || !modal) return; cont.innerHTML = '';
    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;
        let imgName = prod.imagen ? prod.imagen.split(/[/\\\\]/).pop() : '';
        let rImg = imgName ? `imagenes_productos/${imgName}` : 'https://placehold.co/70?text=Prod';
        cont.innerHTML += `
        <div class="fila-despacho">
            <img src="${rImg}" class="img-despacho" onerror="this.onerror=null; this.src='https://placehold.co/70?text=Prod'">
            <div class="info-despacho">
                <h4 style="margin: 0 0 5px 0; font-size: 16px;">${prod.articulo}</h4>
                <span>Código: <code>${prod.codigo}</code></span>
            </div>
            <div class="cant-despacho">${item.cantidad} <span style="font-size:10px; display:block;">Cant.</span></div>
        </div>`;
    });
    modal.style.display = 'flex';
    modal.querySelector('.btn-cerrar-modal').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('btn-imprimir-despacho').onclick = () => { window.print(); };
}

window.abrirLightbox = function(src, titulo) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');
    if (!modal || !img) return;
    modal.style.display = 'flex'; img.src = src; caption.innerText = titulo || "Visualización de producto";
};

window.cerrarLightbox = function() {
    const modal = document.getElementById('lightbox-modal'); if (modal) modal.style.display = 'none';
};

function inicializarBotónVolverArriba() {
    const btnTop = document.getElementById('btn-back-to-top');
    const btnCarritoFlotante = document.getElementById('carrito-flotante');
    if (!btnTop) return;
    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) btnTop.style.display = 'flex';
        else btnTop.style.display = 'none';
        const carritoSeccion = document.querySelector('.carrito');
        if (carritoSeccion) {
            const rect = carritoSeccion.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom >= 0) {
                if(btnCarritoFlotante) btnCarritoFlotante.style.display = 'none';
            } else {
                if(btnCarritoFlotante) btnCarritoFlotante.style.display = 'flex';
            }
        }
    });
    btnTop.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

window.addEventListener('storage', (e) => {
    if (e.key === 'carrito_tienda') {
        recuperarCarritoDeLocalStorage();
        let inventarioGuardado = localStorage.getItem('inventario_tienda_real');
        if (inventarioGuardado) INVENTARIO_GLOBAL = JSON.parse(inventarioGuardado);
        actualizarCarritoVisual();
        filtrarCatalogo();
        renderizarDestacados();
        renderizarWishlist();
    }
});

// Registrar el Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
            .catch(err => console.warn('Error al registrar el Service Worker:', err));
    });
}