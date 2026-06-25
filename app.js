const TELEFONO_WHATSAPP = "527442411773";
let categorySeleccionada = "todas";
let urlGlobalWhatsApp = "";

let INVENTARIO_GLOBAL = [];
let carrito = [];
let indicesCarrusel = {};

// 🔌 Inicializar la conexión WebSocket con tu servidor local
const socket = typeof io !== 'undefined' ? io("http://127.0.0.1:5000") : null;

const EVENTOS_CONFIG = [
    { titulo: "👨 Día del Padre (Electrónica)", fecha: "21 de Junio", descripcion: "¡Sorprende a papá! Descubre electrónica.", categoriaVinculada: "electronica", imagen: "imagenes_eventos/dia_del_padre.jpg" },
    { titulo: "👨 Día del Padre (Ropa)", fecha: "21 de Junio", descripcion: "¡Sorprende a papá! Descubre ropa.", categoriaVinculada: "ropa", imagen: "imagenes_eventos/dia_del_padre.jpg" },
    { titulo: "🎓 Graduaciones (Manualidades)", fecha: "Mes de Julio", descripcion: "Termina una etapa llena de aprendizajes.", categoriaVinculada: "manualidades", imagen: "imagenes_eventos/graduaciones.jpg" },
    { titulo: "🎓 Graduaciones (Ropa)", fecha: "Mes de Julio", descripcion: "Termina una etapa llena de aprendizajes.", categoriaVinculada: "ropa", imagen: "imagenes_eventos/graduaciones.jpg" }
];

window.addEventListener('load', () => {
    configurarTema();
    configuringCamposFecha();
    recuperarCarritoDeLocalStorage();
    inicializarBotónVolverArriba();

    const clienteGuardado = localStorage.getItem('nombre_cliente_dayh');
    if (clienteGuardado && document.getElementById('cliente')) {
        document.getElementById('cliente').value = clienteGuardado;
    }

    mostrarSkeletons();
    setTimeout(() => {
        cargarProductos();
        verificarCarritoGuardadoAlEntrar();
    }, 700); 
    
    renderizarEventos();
    setupEventListeners();
    
    // 🔌 Iniciar la escucha de actualizaciones de stock en vivo
    configurarWebSockets();

    // DETECTAR ENLACES COMPARTIDOS
    setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const productoFiltrado = urlParams.get('prod');

        if (productoFiltrado) {
            const buscadorInput = document.getElementById('buscador');
            if (buscadorInput) {
                buscadorInput.value = productoFiltrado;
                categorySeleccionada = "todas"; 
                filtrarCatalogo();
                
                const catalogoSeccion = document.getElementById('barra-categorias') || document.getElementById('lista-productos');
                if (catalogoSeccion) {
                    catalogoSeccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }
    }, 900);
});

// 🔌 Función para gestionar la recepción de cambios de stock
function configurarWebSockets() {
    if (!socket) return;
    
    socket.on('actualizar_stock_web', (data) => {
        const { codigo, nuevo_stock } = data;
        let producto = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
        
        if (producto) {
            // AGREGADO Y CORREGIDO: Evita descuento doble. Actualiza según base de datos central.
            producto.stock = nuevo_stock;
            
            const itemEnCarrito = carrito.find(i => i.codigo === codigo);
            if (itemEnCarrito && itemEnCarrito.cantidad > producto.stock) {
                itemEnCarrito.cantidad = producto.stock;
                if (itemEnCarrito.cantidad <= 0) {
                    carrito = carrito.filter(c => c.codigo !== codigo);
                }
                actualizarCarritoVisual(); // Refrescar visualmente el carrito
            }
            
            localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
            filtrarCatalogo();
            renderizarDestacados();
            
            // Notificar visualmente si el stock es crítico
            if (producto.stock === 0) {
                mostrarNotificacionFlotante(`❌ Se ha agotado: ${producto.articulo}`, 5000, '#7f1d1d');
            } else if (producto.stock <= 3) {
                mostrarNotificacionFlotante(`🔥 ¡Últimas ${producto.stock} piezas de: ${producto.articulo}!`, 5000, '#9a3412');
            }
        }
    });
}

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
        if(btn.getAttribute('data-cat') && btn.getAttribute('data-cat').toLowerCase() === categoria.toLowerCase()) {
            btn.classList.add('activo');
        }
    });
    filtrarCatalogo();
    if (document.getElementById('buscador')) {
        const buscador = document.getElementById('buscador');
        buscador.value = "";
        // AGREGADO: Cambio de texto para guiar al usuario
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
    document.getElementById('buscador').addEventListener('input', filtrarCatalogo);
    document.querySelectorAll('.btn-categoria').forEach(button => {
        button.addEventListener('click', (e) => {
            seleccionarCategoria(e.currentTarget.getAttribute('data-cat'), e.currentTarget);
        });
    });
    document.getElementById('btn-vaciar').addEventListener('click', vaciarCarrito);
    document.getElementById('btn-enviar-pedido').addEventListener('click', enviarPedidoFinal);
    if (document.getElementById('btn-chat-manual')) document.getElementById('btn-chat-manual').addEventListener('click', abrirChatManual);
    if (document.getElementById('btn-enviar-pedido')) {
        document.getElementById('btn-enviar-pedido').addEventListener('dblclick', (e) => { e.preventDefault(); abrirModalDespacho(); });
    }
}

function configuringCamposFecha() {
    const hoyObj = new Date();
    const hoy = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;

    const DIAS_FESTIVOS = [
        "2026-09-16", 
        "2026-11-16", 
        "2026-12-25"  
    ];

    const campoFecha = document.getElementById('fecha');
    if (campoFecha) {
        campoFecha.min = hoy;
        campoFecha.addEventListener('input', (e) => {
            const fechaSeleccionada = e.target.value;
            if (!fechaSeleccionada) return;
            
            if (DIAS_FESTIVOS.includes(fechaSeleccionada)) {
                alert("⚠️ Los días festivos oficiales no realizamos entregas. Por favor selecciona otro día.");
                e.target.value = '';
                return;
            }

            const fechaObj = new Date(fechaSeleccionada + 'T00:00:00');
            if (fechaObj.getDay() === 0 || fechaObj.getDay() === 6) {
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

function validarHorariosDisponibles() {
    const campoFecha = document.getElementById('fecha');
    const campoHora = document.getElementById('hora');
    if (!campoFecha || !campoHora) return;

    const fechaSeleccionada = campoFecha.value;
    
    const hoyObj = new Date();
    const hoyStr = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;
    
    Array.from(campoHora.options).forEach(opcion => {
        opcion.disabled = false; 
        
        if (fechaSeleccionada === hoyStr) {
            const ahora = new Date();
            const horaActual = ahora.getHours();
            const minActual = ahora.getMinutes();

            let horaOpcion = 0;
            const val = opcion.value; 
            let [hStr, periodo] = val.split(' ');
            let [h, m] = hStr.split(':').map(Number);
            
            if (periodo === "PM" && h !== 12) h += 12;
            if (periodo === "AM" && h === 12) h = 0;
            
            if (h < horaActual || (h === horaActual && minActual > 15)) {
                opcion.disabled = true;
            }
        }
    });

    if (campoHora.selectedOptions[0] && campoHora.selectedOptions[0].disabled) {
        const opcionValida = Array.from(campoHora.options).find(o => !o.disabled);
        if (opcionValida) campoHora.value = opcionValida.value;
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
function recuperarCarritoDeLocalStorage() { const guardado = localStorage.getItem('carrito_tienda'); if (guardado) { carrito = JSON.parse(guardado); } }

function cargarProductos() {
    fetch('productos.json?v=' + Date.now())
        .then(res => res.json())
        .then(json => {
            INVENTARIO_GLOBAL = json.map(p => ({ 
                ...p, 
                stock: parseInt(p.stock) || 0, 
                destacado: p.destacado === true 
            }));
            
            carrito.forEach(item => {
                let p = INVENTARIO_GLOBAL.find(ig => ig.codigo === item.codigo);
                if (p) p.stock = Math.max(0, p.stock - item.cantidad);
            });

            localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
            filtrarCatalogo();
            renderizarDestacados();
            actualizarCarritoVisual();
        })
        .catch(() => {
            let inventarioGuardado = localStorage.getItem('inventario_tienda_real');
            if (inventarioGuardado) { 
                INVENTARIO_GLOBAL = JSON.parse(inventarioGuardado); 
                filtrarCatalogo(); 
                renderizarDestacados(); 
                actualizarCarritoVisual(); 
            }
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

    const txt = `*¡Mira este producto en Tienda DAYH!* 🤩\n\n` +
                `🛍️ *${nombre}*\n` +
                `📌 Código: ${codigo}\n` +
                `💰 Precio: ${formatearDinero(precio)}\n\n` +
                `👇 Ver detalles y agregarlo al carrito aquí:\n` +
                `${enlaceWebProducto}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
};

function generarHTMLTarjeta(prod, esDestacada = false) {
    const stock = prod.stock;
    const esAgotado = stock <= 0 && (!carrito.find(i => i.codigo === prod.codigo));
    let txtStock = `Disponibles: ${stock}`, cStock = 'producto-stock';
    if (stock <= 0) { txtStock = '❌ Agotado'; cStock = 'producto-stock agotado'; }
    else if (stock <= 3) { txtStock = `🔥 ¡Últimas ${stock} pzs!`; cStock = 'producto-stock stock-critico'; }

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

    const itemEnCarrito = carrito.find(i => i.codigo === prod.codigo);
    let botonFilaHTML = '';

    if (itemEnCarrito) {
        botonFilaHTML = `
        <div class="tarjeta-controles-qty">
            <button class="tarjeta-btn-qty" onclick="cambiarCantidad('${prod.codigo}', -1)">-</button>
            <span class="tarjeta-cant-num">${itemEnCarrito.cantidad} pzs</span>
            <button class="tarjeta-btn-qty" onclick="cambiarCantidad('${prod.codigo}', 1)" ${stock <= 0 ? 'disabled' : ''}>+</button>
        </div>`;
    } else {
        botonFilaHTML = `<button class="btn" onclick="agregarAlCarritoConEfecto('${prod.codigo}', this)" ${esAgotado ? 'disabled' : ''}>${esAgotado ? 'Sin existencias' : '🛒 Agregar'}</button>`;
    }

    return `
    <div class="producto-card">
        ${badgeDestacado}
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
    const buscar = document.getElementById('buscador').value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const filtrados = INVENTARIO_GLOBAL.filter(prod => {
        const nom = prod.articulo ? prod.articulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
        const cod = prod.codigo ? prod.codigo.toLowerCase() : "";
        const cat = prod.categoria ? prod.categoria.toLowerCase() : "general";
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
    
    // AGREGADO: Restaurar el buscador visualmente al cambiar la categoría
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
            if (el.id === 'carrito-flotante') {
                el.classList.add('animar-shake');
            } else {
                el.classList.add('animar-pop');
            }
        }
    });
}

window.agregarAlCarrito = function (codigo) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    if (!prod) return;
    if (prod.stock > 0) {
        const item = carrito.find(i => i.codigo === codigo);
        if (item) item.cantidad += 1;
        else carrito.push({ codigo: codigo, cantidad: 1 });
        prod.stock -= 1;
        localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
        guardarCarritoEnLocalStorage();
        actualizarCarritoVisual();
        filtrarCatalogo();
        renderizarDestacados();
        dispararAnimacionCarrito();
    } else {
        alert("Lo sentimos, ya no quedan más unidades.");
    }
};

window.agregarAlCarritoConEfecto = function(codigo, botonElement) {
    agregarAlCarrito(codigo);
    if (botonElement && !botonElement.disabled) {
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

window.cambiarCantidad = function(codigo, cambio) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    const item = carrito.find(i => i.codigo === codigo);
    if (!item || !prod) return;

    if (cambio === 1) {
        if (prod.stock > 0) { item.cantidad += 1; prod.stock -= 1; dispararAnimacionCarrito(); }
        else { alert("Lo sentimos, ya no quedan más unidades."); }
    } else if (cambio === -1) {
        item.cantidad -= 1; prod.stock += 1;
        if (item.cantidad <= 0) {
            const idx = carrito.findIndex(i => i.codigo === codigo);
            if (idx !== -1) carrito.splice(idx, 1);
        }
        dispararAnimacionCarrito();
    }
    localStorage.setItem('inventario_tienda_real', JSON.stringify(INVENTARIO_GLOBAL));
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();
    filtrarCatalogo();
    renderizarDestacados();
};

function vaciarCarrito() {
    if (confirm("¿Estás seguro de vaciar el pedido?")) {
        carrito = [];
        guardarCarritoEnLocalStorage();
        localStorage.removeItem('inventario_tienda_real');
        cargarProductos();
    }
}

function actualizarCarritoVisual() {
    const cont = document.getElementById('items-carrito');
    const txtMonto = document.getElementById('total-monto');
    const btnVaciar = document.getElementById('btn-vaciar');
    const bContador = document.getElementById('badge-contador');
    const bFlotante = document.getElementById('badge-flotante');

    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    if (bContador) bContador.innerText = totalItems;
    if (bFlotante) bFlotante.innerText = totalItems;

    if (carrito.length === 0) {
        cont.innerHTML = '<p style="color: var(--text-light); text-align: center; margin: 20px 0;">El carrito está vacío.</p>';
        if (txtMonto) txtMonto.innerText = "$0.00";
        if (btnVaciar) btnVaciar.style.display = 'none';
        return;
    }

    if (btnVaciar) btnVaciar.style.display = 'block';
    cont.innerHTML = ''; let totalGeneral = 0;

    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;
        const subtotal = (parseFloat(prod.precio) || 0) * item.cantidad;
        totalGeneral += subtotal;
        cont.innerHTML += `
        <div class="item-linea">
            <div class="item-info">
                <span class="item-nombre">[${prod.codigo}] ${prod.articulo}</span>
                <span class="item-precio">${formatearDinero(prod.precio)} c/u</span>
            </div>
            <div class="item-controles">
                <button class="btn-qty" onclick="cambiarCantidad('${prod.codigo}', -1)">-</button>
                <span class="item-cant">${item.cantidad}</span>
                <button class="btn-qty" onclick="cambiarCantidad('${prod.codigo}', 1)" ${prod.stock <= 0 ? 'disabled' : ''}>+</button>
            </div>
        </div>`;
    });
    if (txtMonto) txtMonto.innerText = formatearDinero(totalGeneral);
}

async function enviarPedidoFinal() {
    if (carrito.length === 0) { alert("Tu carrito está vacío"); return; }
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora').value;
    const cliente = document.getElementById('cliente').value.trim();
    const metodoPago = document.getElementById('metodo-pago') ? document.getElementById('metodo-pago').value : "No especificado";

    if (!fecha || !hora || cliente.length < 3) { 
        alert("Por favor completa los campos: Fecha, Hora y Nombre Completo."); 
        return; 
    }

    lanzarEfectoConfeti();

    let total = 0;
    let textoMensajeWhatsApp = `*¡Hola Tienda DAYH! Generé un nuevo pedido* 📄🛒\n\n`;
    textoMensajeWhatsApp += `👤 *Cliente:* ${cliente}\n`;
    textoMensajeWhatsApp += `📅 *Fecha de Entrega:* ${formatearFechaHumana(fecha)}\n`;
    textoMensajeWhatsApp += `⏰ *Hora Aproximada:* ${hora}\n`;
    textoMensajeWhatsApp += `💳 *Forma de Pago:* ${metodoPago}\n\n`;
    textoMensajeWhatsApp += `📦 *DETALLE DEL PEDIDO:*\n`;

    const productosParaAPI = [];

    if (!window.jspdf) {
        console.warn("La librería jsPDF no está disponible, se procederá solo con WhatsApp.");
        carrito.forEach(item => {
            const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
            if (!prod) return;
            const subtotal = prod.precio * item.cantidad; 
            total += subtotal;
            textoMensajeWhatsApp += `▪️ ${item.cantidad}x [${prod.codigo}] ${prod.articulo} - _${formatearDinero(subtotal)}_\n`;
            productosParaAPI.push({ codigo: item.codigo, cantidad: item.cantidad });
        });
    } else {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFillColor(168, 85, 247); 
        doc.rect(0, 0, 210, 35, "F");

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("TIENDA DAYH", 15, 18);
        
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.text("Tu catálogo de confianza — Comprobante Oficial de Pedido", 15, 26);

        doc.setTextColor(17, 24, 39); 
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("DATOS DEL CLIENTE Y LOGÍSTICA", 15, 48);
        
        doc.setDrawColor(192, 132, 252); 
        doc.setLineWidth(0.5);
        doc.line(15, 51, 95, 51);

        doc.setFont("helvetica", "bold");
        doc.text("Nombre Completo:", 15, 59);
        doc.setFont("helvetica", "normal");
        doc.text(cliente, 55, 59);

        doc.setFont("helvetica", "bold");
        doc.text("Fecha de Entrega:", 15, 66);
        doc.setFont("helvetica", "normal");
        doc.text(formatearFechaHumana(fecha), 55, 66);

        doc.setFont("helvetica", "bold");
        doc.text("Hora Aproximada:", 15, 73);
        doc.setFont("helvetica", "normal");
        doc.text(hora, 55, 73);

        doc.setFont("helvetica", "bold");
        doc.text("Método de Pago:", 15, 80);
        doc.setFont("helvetica", "normal");
        doc.text(metodoPago, 55, 80);

        doc.setFont("helvetica", "bold");
        doc.text("DETALLE DEL PEDIDO", 15, 93);
        doc.line(15, 96, 195, 96);

        doc.setFillColor(249, 250, 251); 
        doc.rect(15, 100, 180, 8, "F");
        
        doc.setFontSize(10);
        doc.text("Cant.", 18, 105);
        doc.text("Código", 35, 105);
        doc.text("Descripción del Artículo", 65, 105);
        doc.text("Subtotal", 172, 105);
        
        doc.setDrawColor(229, 231, 235);
        doc.line(15, 108, 195, 108);

        let yPosition = 116;
        doc.setFont("helvetica", "normal");
        
        carrito.forEach((item, index) => {
            const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
            if (!prod) return;
            
            const subtotal = prod.precio * item.cantidad; 
            total += subtotal;
            
            if (yPosition > 270) {
                doc.addPage();
                yPosition = 25; 
                
                doc.setFont("helvetica", "bold");
                doc.setFillColor(249, 250, 251); 
                doc.rect(15, yPosition - 5, 180, 8, "F");
                doc.text("Cant.", 18, yPosition);
                doc.text("Código", 35, yPosition);
                doc.text("Descripción del Artículo", 65, yPosition);
                doc.text("Subtotal", 172, yPosition);
                yPosition += 12;
                doc.setFont("helvetica", "normal");
            }

            if (index % 2 === 0) {
                doc.setFillColor(253, 244, 255); 
                doc.rect(15, yPosition - 5, 180, 8, "F");
            }

            doc.text(`${item.cantidad}x`, 18, yPosition);
            doc.text(prod.codigo, 35, yPosition);
            const itemNombre = prod.articulo.length > 40 ? prod.articulo.substring(0, 37) + "..." : prod.articulo;
            doc.text(itemNombre, 65, yPosition);
            doc.text(formatearDinero(subtotal), 172, yPosition);

            textoMensajeWhatsApp += `▪️ ${item.cantidad}x [${prod.codigo}] ${prod.articulo} - _${formatearDinero(subtotal)}_\n`;
            productosParaAPI.push({ codigo: item.codigo, cantidad: item.cantidad });
            yPosition += 8;
        });

        doc.setDrawColor(168, 85, 247); 
        doc.setLineWidth(1);
        doc.line(15, yPosition, 195, yPosition);
        yPosition += 12;

        doc.setFillColor(243, 232, 255);
        doc.rect(120, yPosition - 6, 75, 10, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(107, 33, 168); 
        doc.text("TOTAL A PAGAR:", 125, yPosition);
        doc.text(formatearDinero(total), 172, yPosition);

        doc.setTextColor(156, 163, 175);
        doc.setFontSize(9);
        doc.setFont("helvetica", "italic");
        doc.text("Gracias por tu preferencia. Conserva este PDF como tu comprobante de compra.", 15, yPosition + 15);

        const safeName = cliente.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        doc.save(`Pedido_${safeName}_${fecha}.pdf`);
    }

    textoMensajeWhatsApp += `\n💰 *TOTAL NETO A PAGAR: ${formatearDinero(total)}*\n\n`;
    if (window.jspdf) {
        textoMensajeWhatsApp += `⚠️ _Nota: Ya he descargado mi comprobante oficial en formato PDF en mi dispositivo._`;
    }

    const numeroDestino = typeof TELEFONO_WHATSAPP !== 'undefined' ? TELEFONO_WHATSAPP : "527442411773";
    const urlWhatsApp = `https://wa.me/${numeroDestino}?text=${encodeURIComponent(textoMensajeWhatsApp)}`;
    
    window.open(urlWhatsApp, '_blank');

    if (document.getElementById('alerta-copiado')) {
        const alerta = document.getElementById('alerta-copiado');
        alerta.innerText = "¡PDF generado y Pedido enviado a WhatsApp con éxito! 📄📱";
        alerta.style.display = 'block';
    }

    fetch('http://127.0.0.1:5000/', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ cliente, fecha_entrega: fecha, hora_entrega: hora, productos: productosParaAPI, metodo_pago: metodoPago }) 
    }).catch(() => console.warn("Python local no disponible"));

    localStorage.setItem("nombre_cliente_dayh", cliente);
    
    carrito = [];
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();
    
    if (document.getElementById("fecha")) document.getElementById("fecha").value = "";
    if (document.getElementById("hora")) document.getElementById("hora").value = "";
    if (document.getElementById("metodo-pago")) document.getElementById("metodo-pago").selectedIndex = 0;
    
    filtrarCatalogo(); 
    renderizarDestacados();
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
    modal.style.display = 'flex';
    img.src = src;
    caption.innerText = titulo || "Visualización de producto";
};

window.cerrarLightbox = function() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) modal.style.display = 'none';
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
    
    btnTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

window.addEventListener('storage', (e) => {
    if (e.key === 'carrito_tienda') {
        recuperarCarritoDeLocalStorage();
        let inventarioGuardado = localStorage.getItem('inventario_tienda_real');
        if (inventarioGuardado) {
            INVENTARIO_GLOBAL = JSON.parse(inventarioGuardado);
        }
        actualizarCarritoVisual();
        filtrarCatalogo();
        renderizarDestacados();
    }
});