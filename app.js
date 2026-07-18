// === REGISTRO DEL SERVICE WORKER ===
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
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
const BACKEND_URL = "http://127.0.0.1:5000"; 
const TELEFONO_WHATSAPP = "527442411773";
let categorySeleccionada = "todas";
let urlGlobalWhatsApp = "";

let INVENTARIO_GLOBAL = [];
let WISHLIST_GLOBAL = [];
let carrito = [];
let indicesCarrusel = {};

let codigoCuponActivo = "";
let cargoPorEnvio = 0; 
let yaExplotoConfettiEnvio = false; 

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
            console.log("Audio bloqueado por interacción:", error);
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
    const inputCliente = document.getElementById('cliente');
    if (clienteGuardado && inputCliente) {
        inputCliente.value = clienteGuardado;
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
                codigoCuponActivo = code;
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
            if (selectEntrega.value.includes("Domicilio")) {
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
        alert("Lo sentimos, ya no quedan más unidades disponibles.");
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
            alert("⚠️ Lo sentimos, no hay más stock disponible.");
            return;
        }
    } else if (cambio === -1) {
        reproducirSonido('eliminar');
        item.cantidad -= 1;
        if (item.cantidad <= 0) {
            carrito = carrito.filter(i => i.codigo !== codigo);
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
    miniNotif.style.position = 'fixed';
    miniNotif.style.right = '20px';
    miniNotif.style.padding = '12px 20px';
    miniNotif.style.borderRadius = '8px';
    miniNotif.style.zIndex = '9999';
    miniNotif.innerHTML = `<span>${mensaje}</span> <button class="btn-cerrar-notif" onclick="this.parentElement.remove()" style="color:white; background:transparent; border:none; margin-left:10px; cursor:pointer;">✕</button>`;
    document.body.appendChild(miniNotif);
    setTimeout(() => { if(miniNotif && miniNotif.parentElement) miniNotif.remove(); }, duracion);
}

function verificarCarritoGuardadoAlEntrar() {
    if (carrito && carrito.length > 0) {
        const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
        mostrarNotificacionFlotante(`🛒 ¡Hola! Conservamos las <strong>${totalItems} pzs</strong> de tu sesión anterior.`, 6000, '#2e1065');
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
    const buscador = document.getElementById('buscador');
    if (buscador) {
        buscador.value = "";
        buscador.placeholder = `🔍 Buscando eventos...`; 
    }
    const barraCat = document.getElementById('barra-categorias');
    if (barraCat) barraCat.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const btnVaciar = document.getElementById('btn-vaciar');
    const btnEnviar = document.getElementById('btn-enviar-pedido');
    const btnChat = document.getElementById('btn-chat-manual');

    if (btnVaciar) btnVaciar.addEventListener('click', vaciarCarrito);
    if (btnEnviar) {
        btnEnviar.addEventListener('click', enviarPedidoFinal);
        btnEnviar.addEventListener('dblclick', (e) => { e.preventDefault(); abrirModalDespacho(); });
    }
    if (btnChat) btnChat.addEventListener('click', abrirChatManual);
    
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
                alert("⚠️ Los días festivos oficiales no realizamos entregas.");
                e.target.value = '';
                return;
            }
            const fechaObj = new Date(fechaSeleccionada + 'T00:00:00');
            if (fechaObj.getDay() === 0 || fechaObj.getDay() === 6) {
                reproducirSonido('error');
                alert("⚠️ Los fines de semana no realizamos entregas.");
                e.target.value = '';
                return;
            }
            validarHorariosDisponibles(); 
        });
    }
    const campoHora = document.getElementById('hora');
    if(campoHora) campoHora.addEventListener('focus', validarHorariosDisponibles);
}

function validarHorariosDisponibles() {
    const campoFecha = document.getElementById('fecha');
    const campoHora = document.getElementById('hora');
    const selectEntrega = document.getElementById('select-punto-entrega');
    if (!campoFecha || !campoHora) return;

    const fechaSeleccionada = campoFecha.value;
    const ahora = new Date();
    const hoyStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const valorPreseleccion = campoHora.value;
    const esEnvio = selectEntrega && selectEntrega.value.includes("Domicilio");

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
            opt.value = "04:00 PM";
            opt.innerText = "04:00 p. m. a 05:00 p. m. (Rango único)";
            campoHora.appendChild(opt);
        } else {
            const opt = document.createElement('option');
            opt.value = "";
            opt.innerText = "❌ Horario fuera de límite (Solicitar para mañana)";
            campoHora.appendChild(opt);
        }
        return;
    }

    const mapeoHorasFijas = [
        { v: "09:00 AM", t: "09:00 a. m." }, { v: "10:00 AM", t: "10:00 a. m." },
        { v: "11:00 AM", t: "11:00 a. m." }, { v: "12:00 PM", t: "12:00 p. m." },
        { v: "01:00 PM", t: "01:00 p. m." }, { v: "02:00 PM", t: "02:00 p. m." },
        { v: "03:00 PM", t: "03:00 p. m." }, { v: "04:00 PM", t: "04:00 p. m." },
        { v: "05:00 PM", t: "05:00 p. m." }
    ];

    mapeoHorasFijas.forEach(opcion => {
        let incluir = true;
        if (fechaSeleccionada === hoyStr) {
            const horaActual = ahora.getHours();
            const minActual = ahora.getMinutes();
            let [hStr, periodo] = opcion.v.split(' ');
            let [h, m] = hStr.split(':').map(Number);
            if (periodo === "PM" && h !== 12) h += 12;
            if (periodo === "AM" && h === 12) h = 0;
            if (h < horaActual || (h === horaActual && minActual > 15)) incluir = false;
        }
        if (incluir) {
            const opt = document.createElement('option');
            opt.value = opcion.v; opt.innerText = opcion.t;
            campoHora.appendChild(opt);
        }
    });

    if (Array.from(campoHora.options).some(o => o.value === valorPreseleccion)) {
        campoHora.value = valorPreseleccion;
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
    
    const imgNormal = document.getElementById(`img-carrusel-${codigo}`);
    const imgDest = document.getElementById(`img-carrusel-dest-${codigo}`);
    if (imgNormal) imgNormal.src = nRuta;
    if (imgDest) imgDest.src = nRuta;
};

window.compartirProducto = function(codigo, nombre, precio) {
    const urlBase = window.location.origin + window.location.pathname;
    const enlaceWebProducto = `${urlBase}?prod=${encodeURIComponent(codigo)}`;
    const txt = `*¡Mira este producto en Tienda DAYH!* 🤩\n\n🛍️ *${nombre}*\n📌 Código: ${codigo}\n💰 Precio: ${formatearDinero(precio)}\n\n👇 Ver detalles aquí:\n${enlaceWebProducto}`;
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
    const buscador = document.getElementById('buscador');
    if (buscador) {
        buscador.placeholder = cat === 'todas' 
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
        botonElement.innerHTML = "¡Añadido! ✓";
        setTimeout(() => {
            botonElement.disabled = false;
            botonElement.style.background = "";
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
    particula.style.position = 'fixed';
    particula.style.zIndex = '10000';
    particula.style.transition = 'all 0.6s ease';
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

function actualizarCarritoVisual() {
    const cont = document.getElementById('items-carrito') || document.getElementById('productos-contenedor');
    const txtMonto = document.getElementById('total-monto');
    const btnVaciar = document.getElementById('btn-vaciar');
    const bContador = document.getElementById('badge-contador');
    const bFlotante = document.getElementById('badge-flotante');
    
    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    if (bContador) bContador.innerText = totalItems;
    if (bFlotante) bFlotante.innerText = totalItems;

    const infoEnvioGratis = document.getElementById('info-envio-gratis');
    const contenedorDireccion = document.getElementById('contenedor-direccion-envio');
    const puntoEntrega = document.getElementById('select-punto-entrega');

    if (carrito.length === 0) {
        yaExplotoConfettiEnvio = false; 
        if (cont) {
            cont.innerHTML = '<p style="color: var(--text-light); text-align: center; margin: 20px 0;">Tu carrito está vacío.</p>';
        }
        if (txtMonto) txtMonto.innerText = "$0.00";
        if (btnVaciar) btnVaciar.style.display = 'none';
        
        const subResumen = document.getElementById('resumen-subtotal');
        const fDescuento = document.getElementById('fila-descuento');
        const fEnvio = document.getElementById('fila-envio');

        if (subResumen) subResumen.innerText = "$0.00";
        if (fDescuento) fDescuento.style.display = "none";
        if (fEnvio) fEnvio.style.display = "none";
        if (infoEnvioGratis) infoEnvioGratis.style.display = "none";
        if (contenedorDireccion) contenedorDireccion.style.display = "none";
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
                <img src="${rutaImagen}" alt="${artLimpio}" style="width: 50px; height: 50px; object-fit: contain;" onerror="this.src='https://placehold.co/50x50';">
                <div style="flex: 1; min-width: 0;">
                    <h4 style="margin:0; font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${artLimpio}</h4>
                    <span style="font-size: 12px; color: var(--primary-light); font-weight: bold;">${formatearDinero(prod.precio)}</span>
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 5px;">
                        <button onclick="cambiarCantidad('${prod.codigo}', -1)">-</button>
                        <span>${item.cantidad}</span>
                        <button onclick="cambiarCantidad('${prod.codigo}', 1)">+</button>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div>${formatearDinero(subtotalProducto)}</div>
                    <button onclick="eliminarDelCarritoVisual('${prod.codigo}')" style="background:transparent; border:none; color:var(--danger); cursor:pointer;">🗑️</button>
                </div>
            </div>`;
        if (cont) cont.innerHTML += itemHTML;
    });

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
            infoEnvioGratis.innerHTML = `<div style="color: var(--success); font-weight: bold;">🎉 ¡Envío a Domicilio GRATIS desbloqueado!</div>`;
        } else {
            infoEnvioGratis.innerHTML = `<div>Faltan ${formatearDinero(metaEnvio - subtotalGeneral)} para Envío GRATIS</div>`;
        }
    }

    if (puntoEntrega) {
        const tieneDomicilio = Array.from(puntoEntrega.options).some(o => o.value.includes("Domicilio"));
        if (alcanzoEnvioGratis && !tieneDomicilio) {
            const opt = document.createElement('option');
            opt.value = "Envío a Domicilio (Zona Urbana)";
            opt.innerText = "Envío a Domicilio (¡GRATIS!)";
            puntoEntrega.appendChild(opt);
        } else if (!alcanzoEnvioGratis) {
            puntoEntrega.innerHTML = `<option value="TIENDA DAYH (Entrega Física)">TIENDA DAYH (Entrega Física) - Gratis</option>`;
            if (contenedorDireccion) contenedorDireccion.style.display = "none";
        }
    }

    let totalFinal = Math.max(0, subtotalGeneral - montoDescuento);
    
    const subResumen = document.getElementById('resumen-subtotal');
    if (subResumen) subResumen.innerText = formatearDinero(subtotalGeneral);

    const filaDescuento = document.getElementById('fila-descuento');
    const resDescuento = document.getElementById('resumen-descuento');
    if (filaDescuento && resDescuento) {
        if (montoDescuento > 0) {
            filaDescuento.style.display = "flex";
            resDescuento.innerText = `-${formatearDinero(montoDescuento)}`;
        } else {
            filaDescuento.style.display = "none";
        }
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
    const sugeridos = INVENTARIO_GLOBAL.filter(p => p.stock > 0 && !codigosEnCarrito.includes(p.codigo)).slice(0, 2);

    if (sugeridos.length === 0) {
        contenedorCross.style.display = 'none';
        return;
    }

    contenedorCross.style.display = 'block';
    contenedorCross.innerHTML = `
        <h4 class="titulo-cross">✨ Te podría interesar:</h4>
        <div class="productos-cross-grid">
            ${sugeridos.map(p => {
                const arrImg = obtenerArregloImagenes(p);
                let imgN = arrImg[0] ? arrImg[0].split(/[/\\\\]/).pop() : '';
                let rImg = imgN ? `imagenes_productos/${imgN}` : 'https://placehold.co/50x50?text=Prod';
                return `
                <div class="tarjeta-cross" style="display:flex; align-items:center; gap:10px; margin-top:5px;">
                    <img src="${rImg}" style="width:40px; height:40px; object-fit:contain;" onerror="this.src='https://placehold.co/50x50';">
                    <div>
                        <strong>${p.articulo}</strong><br>
                        <span>$${p.precio.toFixed(2)}</span>
                    </div>
                    <button onclick="agregarAlCarrito('${p.codigo}')" style="margin-left:auto;">+ Añadir</button>
                </div>`;
            }).join('')}
        </div>`;
}

async function enviarPedidoFinal() {
    if (carrito.length === 0) { alert("Tu carrito está vacío"); return; }
    
    const puntoEntrega = document.getElementById('select-punto-entrega');
    const valorPuntoEntrega = puntoEntrega ? puntoEntrega.value : "TIENDA DAYH (Entrega Física)";
    
    const campoFecha = document.getElementById('fecha');
    const campoHora = document.getElementById('hora');
    const campoCliente = document.getElementById('cliente');
    const campoPago = document.getElementById('metodo-pago');
    const campoDireccion = document.getElementById('direccion-envio');

    const fecha = campoFecha ? campoFecha.value : "";
    const hora = campoHora ? campoHora.value : "";
    const cliente = campoCliente ? campoCliente.value.trim() : "";
    const metodoPago = campoPago ? campoPago.value : "Efectivo";
    const direccionEnvio = campoDireccion ? campoDireccion.value.trim() : "";

    if (valorPuntoEntrega.includes("Domicilio") && direccionEnvio.length < 5) {
        alert("Por favor, escribe la dirección completa.");
        return;
    }

    if (!fecha || !hora || cliente.length < 3) { 
        alert("Por favor completa los campos obligatorios."); 
        return; 
    }

    const btnEnviar = document.getElementById('btn-enviar-pedido');
    const textoOriginal = btnEnviar ? btnEnviar.innerText : "Confirmar";
    if(btnEnviar) { btnEnviar.innerText = "Procesando..."; btnEnviar.disabled = true; }

    let subtotalProductos = 0;
    let montoDescuento = 0;
    const configCupon = CUPONES_CONFIG[codigoCuponActivo] || null;
    const productosParaAPI = [];

    let textoMensajeWhatsApp = `*¡Hola Tienda DAYH! Generé un nuevo pedido* 📄🛒\n\n`;
    textoMensajeWhatsApp += `👤 *Cliente:* ${cliente}\n📍 *Punto/Entrega:* ${valorPuntoEntrega}\n`;
    if (valorPuntoEntrega.includes("Domicilio")) textoMensajeWhatsApp += `🏠 *Dirección:* ${direccionEnvio}\n`;
    textoMensajeWhatsApp += `📅 *Fecha:* ${formatearFechaHumana(fecha)}\n⏰ *Hora:* ${hora}\n💳 *Pago:* ${metodoPago}\n`;
    
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

    let totalGeneral = Math.max(0, subtotalProductos - montoDescuento);
    textoMensajeWhatsApp += `\n💰 *Subtotal:* ${formatearDinero(subtotalProductos)}\n`;
    if (montoDescuento > 0) textoMensajeWhatsApp += `📉 *Descuento:* -${formatearDinero(montoDescuento)}\n`;
    textoMensajeWhatsApp += `💵 *TOTAL NETO A PAGAR: ${formatearDinero(totalGeneral)}*\n`;

    try {
        if (window.jspdf) {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.text("TIENDA DAYH - COMPROBANTE", 15, 15);
            doc.text(`Cliente: ${cliente}`, 15, 25);
            doc.text(`Total: ${formatearDinero(totalGeneral)}`, 15, 35);
            doc.save(`Pedido_${cliente.replace(/ /g, "_")}.pdf`);
        }

        await fetch(`${BACKEND_URL}/api/pedidos`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ cliente, fecha_entrega: fecha, hora_entrega: hora, productos: productosParaAPI, metodo_pago: metodoPago, direccion: direccionEnvio }) 
        });
    } catch (err) {
        console.error("Modo fallback activo:", err);
    } finally {
        reproducirSonido('pedido');
        carrito = [];
        codigoCuponActivo = "";
        guardarCarritoEnLocalStorage();
        actualizarCarritoVisual();
        localStorage.setItem("nombre_cliente_dayh", cliente);
        window.open(`https://wa.me/${TELEFONO_WHATSAPP}?text=${encodeURIComponent(textoMensajeWhatsApp)}`, '_blank');
        if(btnEnviar) { btnEnviar.innerText = textoOriginal; btnEnviar.disabled = false; }
    }
}

function abrirChatManual() { if (urlGlobalWhatsApp) window.open(urlGlobalWhatsApp, '_blank'); }

function abrirModalDespacho() {
    if (carrito.length === 0) return;
    const modal = document.getElementById('modal-despacho');
    if (modal) modal.style.display = 'flex';
}

window.abrirLightbox = function(src, titulo) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) { modal.style.display = 'flex'; img.src = src; }
};

window.cerrarLightbox = function() {
    const modal = document.getElementById('lightbox-modal'); if (modal) modal.style.display = 'none';
};

function inicializarBotónVolverArriba() {
    const btnTop = document.getElementById('btn-back-to-top');
    if (btnTop) btnTop.addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

window.addEventListener('storage', (e) => {
    if (e.key === 'carrito_tienda') {
        recuperarCarritoDeLocalStorage();
        actualizarCarritoVisual();
    }
});