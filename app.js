const TELEFONO_WHATSAPP = "527442411773";
let categorySeleccionada = "todas";
let urlGlobalWhatsApp = "";

let INVENTARIO_GLOBAL = [];
let carrito = [];

let indicesCarrusel = {};

// =========================================================================
// CONFIGURACIÓN DE EVENTOS
// =========================================================================
const EVENTOS_CONFIG = [
    {
        titulo: "👨Día del Padre(Electronica)",
        fecha: "21 de Junio",
        descripcion: "¡Sorprende a papá! Descubre electrónica y accesorios con precios especiales.",
        categoriaVinculada: "electronica",
        imagen: "imagenes_eventos/dia_del_padre.jpg" 
    },
    {
        titulo: "👨Día del Padre(Ropa)",
        fecha: "21 de Junio",
        descripcion: "¡Sorprende a papá! Descubre ropa y accesorios con precios especiales.",
        categoriaVinculada: "ropa",
        imagen: "imagenes_eventos/dia_del_padre.jpg" 
    },
    {
        titulo: " 🎓Graduaciones(Manualidades)",
        fecha: "Mes de Julio",
        descripcion: "Termina una etapa llena de aprendizajes; comienza una nueva aventura aquí.",
        categoriaVinculada: "manualidades",
        imagen: "imagenes_eventos/graduaciones.jpg"
    },
    {
        titulo: " 🎓Graduaciones(Ropa)",
        fecha: "Mes de Julio",
        descripcion: "Termina una etapa llena de aprendizajes; comienza una nueva aventura aquí.",
        categoriaVinculada: "ropa",
        imagen: "imagenes_eventos/graduaciones.jpg"
    }
];

window.addEventListener('load', () => {
    configurarTema();
    configuringCamposFecha();
    recuperarCarritoDeLocalStorage();

    const clienteGuardado = localStorage.getItem('nombre_cliente_dayh');
    if (clienteGuardado && document.getElementById('cliente')) {
        document.getElementById('cliente').value = clienteGuardado;
    }

    cargarProductos();
    renderizarEventos();
    setupEventListeners();
});

function renderizarEventos() {
    const contenedor = document.getElementById('lista-eventos');
    const seccionEventos = document.getElementById('seccion-eventos');
    
    if (!contenedor || !seccionEventos) return;

    if (EVENTOS_CONFIG.length === 0) {
        seccionEventos.style.display = 'none';
        return;
    }

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
        </div>
        `;
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
    
    const buscadorInput = document.getElementById('buscador');
    if (buscadorInput) {
        buscadorInput.value = ""; 
    }
    
    const seccionProductos = document.getElementById('barra-categorias');
    if (seccionProductos) {
        seccionProductos.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function configurarTema() {
    const temaGuardado = localStorage.getItem('tema_tienda');
    const btnTema = document.getElementById('btn-tema');

    if (temaGuardado === 'light') {
        document.body.classList.add('light-mode');
        if (btnTema) btnTema.innerText = '🌙';
    } else {
        if (btnTema) btnTema.innerText = '☀️';
    }

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
            const categoria = e.target.getAttribute('data-cat');
            seleccionarCategoria(categoria, e.target);
        });
    });

    document.getElementById('btn-vaciar').addEventListener('click', vaciarCarrito);
    document.getElementById('btn-enviar-pedido').addEventListener('click', enviarPedidoFinal);
    document.getElementById('btn-chat-manual').addEventListener('click', abrirChatManual);

    const btnEnviar = document.getElementById('btn-enviar-pedido');
    if (btnEnviar) {
        btnEnviar.addEventListener('dblclick', (e) => {
            e.preventDefault();
            abrirModalDespacho();
        });
    }
}

function configuringCamposFecha() {
    const hoy = new Date().toISOString().split('T')[0];
    const campoFecha = document.getElementById('fecha');

    if (campoFecha) {
        campoFecha.min = hoy;
        campoFecha.addEventListener('input', (e) => {
            const fechaSeleccionada = e.target.value;
            if (!fechaSeleccionada) return;

            const fechaObj = new Date(fechaSeleccionada + 'T00:00:00');
            const diaSemana = fechaObj.getDay();

            if (diaSemana === 0 || diaSemana === 6) {
                alert("⚠️ Los fines de semana no realizamos entregas. Por favor, selecciona un día de Lunes a Viernes.");
                e.target.value = '';
            }
        });
    }
}

function formatearDinero(numero) {
    let num = parseFloat(numero);
    if (isNaN(num)) num = 0;
    return '$' + num.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
}

function formatearFechaHumana(fechaISO) {
    if (!fechaISO) return "";
    const partes = fechaISO.split('-');
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${partes[2]} de ${meses[parseInt(partes[1]) - 1]} de ${partes[0]}`;
}

function guardarCarritoEnLocalStorage() {
    localStorage.setItem('carrito_tienda', JSON.stringify(carrito));
}

function recuperarCarritoDeLocalStorage() {
    const carritoGuardado = localStorage.getItem('carrito_tienda');
    if (carritoGuardado) {
        carrito = JSON.parse(carritoGuardado);
    }
}

function cargarProductos() {
    let inventarioLocal = JSON.parse(localStorage.getItem('inventario_tienda')) || [];

    fetch('productos.json?v=' + Date.now())
        .then(response => response.json())
        .then(productosJson => {
            INVENTARIO_GLOBAL = productosJson.map((prodJson) => {
                const itemEnCarrito = carrito.find(c => c.codigo === prodJson.codigo);
                const cantidadEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;

                let precioLimpio = parseFloat(prodJson.precio);
                if (isNaN(precioLimpio)) precioLimpio = 0;

                let stockLimpio = parseInt(prodJson.stock);
                if (isNaN(stockLimpio)) stockLimpio = 0;

                let stockActualizado = stockLimpio - cantidadEnCarrito;
                let esDestacado = prodJson.destacado === true;

                return {
                    ...prodJson,
                    precio: precioLimpio,
                    stock: stockActualizado >= 0 ? stockActualizado : 0,
                    destacado: esDestacado
                };
            });

            localStorage.setItem('inventario_tienda', JSON.stringify(INVENTARIO_GLOBAL));
            filtrarCatalogo();
            renderizarDestacados();
        })
        .catch(error => {
            console.error('Error al cargar inventario:', error);
            if (inventarioLocal.length > 0) {
                INVENTARIO_GLOBAL = inventarioLocal;
                filtrarCatalogo();
                renderizarDestacados();
            }
        });
}

function obtenerArregloImagenes(prod) {
    if (!prod.imagen) return [];
    if (prod.imagen.includes(',')) {
        return prod.imagen.split(',').map(img => img.trim());
    }
    return [prod.imagen];
}

window.moverImagenCarrusel = function (codigo, direccion) {
    const prod = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    if (!prod) return;

    const imagenes = obtenerArregloImagenes(prod);
    if (imagenes.length <= 1) return;

    if (indicesCarrusel[codigo] === undefined) {
        indicesCarrusel[codigo] = 0;
    }

    indicesCarrusel[codigo] += direccion;

    if (indicesCarrusel[codigo] >= imagenes.length) {
        indicesCarrusel[codigo] = 0;
    } else if (indicesCarrusel[codigo] < 0) {
        indicesCarrusel[codigo] = imagenes.length - 1;
    }

    let rutaCruda = imagenes[indicesCarrusel[codigo]];
    let nombreImagen = rutaCruda ? rutaCruda.split(/[/\\\\]/).pop() : '';
    let nuevaRuta = nombreImagen ? `imagenes_productos/${nombreImagen}` : 'https://placehold.co/300';

    const imgNormal = document.getElementById(`img-carrusel-${codigo}`);
    if (imgNormal) imgNormal.src = nuevaRuta;

    const imgDestacado = document.getElementById(`img-carrusel-dest-${codigo}`);
    if (imgDestacado) imgDestacado.src = nuevaRuta;
};

function limpiarAcentos(texto) {
    return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function generarHTMLTarjeta(prod, esSeccionDestacada = false) {
    const stockDisponibleReal = prod.stock;
    const esAgotado = stockDisponibleReal <= 0;

    let textoStock = `Disponibles: ${stockDisponibleReal}`;
    let claseStock = 'producto-stock';

    if (esAgotado) {
        textoStock = '❌ Agotado';
        claseStock = 'producto-stock agotado';
    } else if (stockDisponibleReal <= 3) {
        textoStock = `🔥 ¡Últimas ${stockDisponibleReal} pzs!`;
        claseStock = 'producto-stock stock-critico';
    }

    const arrayImagenes = obtenerArregloImagenes(prod);
    const tieneCarrusel = arrayImagenes.length > 1;

    let nombreImagen = arrayImagenes[0] ? arrayImagenes[0].split(/[/\\\\]/).pop() : '';
    let rutaImagen = nombreImagen ? `imagenes_productos/${nombreImagen}` : 'https://placehold.co/300?text=No+disponible';
    const articuloLimpio = prod.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const idAtributoImagen = esSeccionDestacada ? `img-carrusel-dest-${prod.codigo}` : `img-carrusel-${prod.codigo}`;

    const btnIzq = tieneCarrusel ? `<button class="carousel-btn left" onclick="moverImagenCarrusel('${prod.codigo}', -1)">◀</button>` : '';
    const btnDer = tieneCarrusel ? `<button class="carousel-btn right" onclick="moverImagenCarrusel('${prod.codigo}', 1)">▶</button>` : '';

    const badgeDestacado = (!esSeccionDestacada && prod.destacado) ? `<div class="badge-destacado">OFERTA</div>` : '';

    return `
    <div class="producto-card">
        ${badgeDestacado}
        <div>
            <div class="producto-codigo">CÓDIGO: ${prod.codigo}</div>
            <div class="img-wrapper">
                ${btnIzq}
                <img id="${idAtributoImagen}" src="${rutaImagen}" alt="${articuloLimpio}" onerror="this.onerror=null; this.src='https://placehold.co/300?text=${encodeURIComponent(articuloLimpio)}'">
                ${btnDer}
            </div>
            <h3>${articuloLimpio}</h3>
            <div class="${claseStock}">${textoStock}</div>
            <p style="color: var(--primary-light); font-weight: 700; font-size: 16px; margin: 0 0 6px 0;">${formatearDinero(prod.precio)}</p>
        </div>
        <button class="btn" onclick="agregarAlCarritoGlobal('${prod.codigo}')" ${esAgotado ? 'disabled' : ''}>
            ${esAgotado ? 'Sin existencias' : 'Agregar'}
        </button>
    </div>
    `;
}

window.agregarAlCarritoGlobal = function (codigo) {
    agregarAlCarrito(codigo);
}

window.filtrarPorEvento = filtrarPorEvento;

function renderizarDestacados() {
    const contenedorDestacados = document.getElementById('lista-destacados');
    const seccionCompleta = document.getElementById('seccion-destacados');
    if (!contenedorDestacados || !seccionCompleta) return;

    const productosDestacados = INVENTARIO_GLOBAL.filter(p => p.destacado === true);

    if (productosDestacados.length === 0) {
        seccionCompleta.style.display = 'none';
        return;
    }

    seccionCompleta.style.display = 'block';
    contenedorDestacados.innerHTML = '';

    productosDestacados.forEach(prod => {
        contenedorDestacados.innerHTML += generarHTMLTarjeta(prod, true);
    });
}

function renderizarTarjetasHTML(productosAMostrar) {
    const contenedor = document.getElementById('lista-productos');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    if (productosAMostrar.length === 0) {
        contenedor.innerHTML = '<p class="sin-resultados">No encontramos productos.</p>';
        return;
    }

    productosAMostrar.forEach(prod => {
        contenedor.innerHTML += generarHTMLTarjeta(prod, false);
    });
}

function filtrarCatalogo() {
    const textoBusqueda = limpiarAcentos(document.getElementById('buscador').value.trim());

    const productosFiltrados = INVENTARIO_GLOBAL.filter(prod => {
        const nombreValido = prod.articulo ? limpiarAcentos(prod.articulo) : "";
        const codigoValido = prod.codigo ? prod.codigo.toLowerCase() : "";
        const categoriaValida = prod.categoria ? prod.categoria.toLowerCase() : "general";

        return (nombreValido.includes(textoBusqueda) || codigoValido.includes(textoBusqueda)) &&
            (categorySeleccionada === "todas" || categoriaValida === categorySeleccionada.toLowerCase());
    });
    renderizarTarjetasHTML(productosFiltrados);
}

function seleccionarCategoria(categoria, elemento) {
    categorySeleccionada = categoria;
    document.querySelectorAll('.btn-categoria').forEach(btn => btn.classList.remove('activo'));
    if (elemento) elemento.classList.add('activo');
    filtrarCatalogo();
}

function agregarAlCarrito(codigo) {
    const producto = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    if (!producto) return;

    if (producto.stock > 0) {
        const itemEnCarrito = carrito.find(item => item.codigo === codigo);
        if (itemEnCarrito) {
            itemEnCarrito.cantidad += 1;
        } else {
            carrito.push({ codigo: codigo, cantidad: 1 });
        }
        producto.stock -= 1;
        guardarCarritoEnLocalStorage();
        actualizarCarritoVisual();
        filtrarCatalogo();
        renderizarDestacados();
    } else {
        alert("Lo sentimos, ya no quedan más unidades.");
    }
}

function cambiarCantidad(codigo, cambio) {
    const producto = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    const itemEnCarrito = carrito.find(item => item.codigo === codigo);
    if (!itemEnCarrito || !producto) return;

    if (cambio === 1) {
        if (producto.stock > 0) {
            itemEnCarrito.cantidad += 1;
            producto.stock -= 1;
        } else {
            alert("Lo sentimos, ya no quedan más unidades.");
        }
    } else if (cambio === -1) {
        itemEnCarrito.cantidad -= 1;
        producto.stock += 1;
        if (itemEnCarrito.cantidad <= 0) {
            const index = carrito.findIndex(item => item.codigo === codigo);
            if (index !== -1) carrito.splice(index, 1);
        }
    }
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();
    filtrarCatalogo();
    renderizarDestacados();
}

function vaciarCarrito() {
    if (confirm("¿Estás seguro de vaciar el pedido?")) {
        carrito = [];
        guardarCarritoEnLocalStorage();
        cargarProductos();
    }
}

function actualizarCarritoVisual() {
    const contenedor = document.getElementById('items-carrito');
    const txtMonto = document.getElementById('total-monto');
    const btnVaciar = document.getElementById('btn-vaciar');
    const badgeContador = document.getElementById('badge-contador');
    const badgeFlotante = document.getElementById('badge-flotante');

    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    if (badgeContador) badgeContador.innerText = totalItems;
    if (badgeFlotante) badgeFlotante.innerText = totalItems;

    if (carrito.length === 0) {
        contenedor.innerHTML = '<p style="color: var(--text-light); text-align: center; margin: 20px 0;">El carrito está vacío.</p>';
        if (txtMonto) txtMonto.innerText = "$0.00";
        if (btnVaciar) btnVaciar.style.display = 'none';
        return;
    }

    if (btnVaciar) btnVaciar.style.display = 'block';
    contenedor.innerHTML = '';
    let totalGeneral = 0;

    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;

        const precioSeguro = parseFloat(prod.precio) || 0;
        const subtotal = precioSeguro * item.cantidad;
        totalGeneral += subtotal;
        const sinStockMas = prod.stock <= 0;

        contenedor.innerHTML += `
        <div class="item-linea">
            <div class="item-info">
                <span class="item-nombre">[${prod.codigo}] ${prod.articulo}</span>
                <span class="item-precio">${formatearDinero(precioSeguro)} c/u</span>
            </div>
            <div class="item-controles">
                <button class="btn-qty" onclick="cambiarCantidad('${prod.codigo}', -1)">-</button>
                <span class="item-cant">${item.cantidad}</span>
                <button class="btn-qty" onclick="cambiarCantidad('${prod.codigo}', 1)" ${sinStockMas ? 'disabled' : ''}>+</button>
            </div>
        </div>
        `;
    });

    if (txtMonto) txtMonto.innerText = formatearDinero(totalGeneral);
}

async function enviarPedidoFinal() {
    if (carrito.length === 0) {
        alert("Tu carrito está vacío");
        return;
    }

    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora').value;
    const cliente = document.getElementById('cliente').value.trim();

    if (!fecha) {
        alert("Selecciona la fecha de entrega");
        return;
    }

    if (!hora) {
        alert("Por favor, selecciona una hora aproximada para tu entrega.");
        return;
    }

    if (cliente.length < 3) {
        alert("Escribe tu nombre completo.");
        return;
    }

    let mensaje = "*¡HOLA, TIENDA DAYH!*\\n";
    mensaje += "Quiero agendar el siguiente pedido:\\n";
    mensaje += "━━━━━━━━━━━━━━━━━━━━━\\n\\n";
    mensaje += "*CLIENTE:* " + cliente + "\\n\\n";
    mensaje += "*PRODUCTOS SOLICITADOS:*\\n";

    let total = 0;
    const productosParaAPI = [];

    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;

        const precio = parseFloat(prod.precio) || 0;
        const subtotal = precio * item.cantidad;
        total += subtotal;

        mensaje += `*${item.cantidad}x* [${prod.codigo}] ${prod.articulo} ➔ ${formatearDinero(subtotal)}\\n`;
        productosParaAPI.push({ codigo: item.codigo, cantidad: item.cantidad });
    });

    mensaje += "\\n━━━━━━━━━━━━━━━━━━━━━\\n";
    mensaje += "*TOTAL:* " + formatearDinero(total) + "\\n";
    mensaje += "*FECHA DE ENTREGA:* " + formatearFechaHumana(fecha) + "\\n";
    mensaje += "*HORA APROX:* " + hora + "\\n";

    const datosPedido = {
        cliente: cliente,
        telefono: "",
        fecha_entrega: fecha,
        hora_entrega: hora,
        productos: productosParaAPI
    };

    urlGlobalWhatsApp = "https://wa.me/" + TELEFONO_WHATSAPP + "?text=" + encodeURIComponent(mensaje);

    const divAlerta = document.getElementById('alerta-copiado');
    if(divAlerta) divAlerta.style.display = 'block';

    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        window.location.href = urlGlobalWhatsApp;
    } else {
        window.open(urlGlobalWhatsApp, "_blank");
    }

    fetch('http://127.0.0.1:5000/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosPedido)
    }).then(() => console.log("[WEB] Datos enviados a Python local"))
        .catch(() => console.warn("[AVISO] Python local no disponible"));

    localStorage.setItem("inventario_tienda", JSON.stringify(INVENTARIO_GLOBAL));
    localStorage.setItem("nombre_cliente_dayh", cliente);

    carrito = [];
    guardarCarritoEnLocalStorage();
    actualizarCarritoVisual();

    if (document.getElementById("fecha")) document.getElementById("fecha").value = "";
    if (document.getElementById("hora")) document.getElementById("hora").value = ""; 

    filtrarCatalogo();
    renderizarDestacados();
}

function abrirChatManual() {
    if (urlGlobalWhatsApp) window.open(urlGlobalWhatsApp, '_blank');
}

function abrirModalDespacho() {
    if (carrito.length === 0) {
        alert("El carrito está vacío. No hay mercancía que despachar.");
        return;
    }

    const contenedorDetalle = document.getElementById('detalle-despacho-productos');
    const modal = document.getElementById('modal-despacho');

    if (!contenedorDetalle || !modal) return;

    contenedorDetalle.innerHTML = '';

    carrito.forEach(item => {
        const prod = INVENTARIO_GLOBAL.find(p => p.codigo === item.codigo);
        if (!prod) return;

        let nombreImagen = prod.imagen ? prod.imagen.split(/[/\\\\]/).pop() : '';
        let rutaImagen = nombreImagen ? `imagenes_productos/${nombreImagen}` : 'https://placehold.co/70?text=Prod';
        const articuloLimpio = prod.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        contenedorDetalle.innerHTML += `
        <div class="fila-despacho">
            <img src="${rutaImagen}" alt="${articuloLimpio}" class="img-despacho" onerror="this.onerror=null; this.src='https://placehold.co/70?text=Prod'">
            <div class="info-despacho">
                <h4 style="margin: 0 0 5px 0; font-size: 16px;">${articuloLimpio}</h4>
                <span style="font-size: 13px; color: var(--text-light);">Código: <code>${prod.codigo}</code></span>
            </div>
            <div class="cant-despacho">
                ${item.cantidad} <span style="font-size: 10px; display:block; font-weight: normal; opacity: 0.8;">Cant.</span>
            </div>
        </div>
        `;
    });

    modal.style.display = 'flex';

    const btnCerrar = modal.querySelector('.btn-cerrar-modal');
    if (btnCerrar) {
        btnCerrar.onclick = () => { modal.style.display = 'none'; };
    }

    modal.onclick = (e) => {
        if (e.target === modal) { modal.style.display = 'none'; }
    };

    const btnImprimir = document.getElementById('btn-imprimir-despacho');
    if (btnImprimir) {
        btnImprimir.onclick = () => {
            window.print();
        };
    }
}