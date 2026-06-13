const TELEFONO_WHATSAPP = "527442411773"; 
let categorySeleccionada = "todas";
let urlGlobalWhatsApp = "";

let INVENTARIO_GLOBAL = [];
let carrito = []; 

window.addEventListener('load', () => {
    configuringCamposFecha();
    recuperarCarritoDeLocalStorage(); 
    cargarProductos(); 
    setupEventListeners();
});

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
    return '$' + numero.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
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
    // Intentar leer el inventario temporal guardado en el navegador
    let inventarioLocal = JSON.parse(localStorage.getItem('inventario_tienda')) || [];

    fetch('productos.json')
        .then(response => response.json())
        .then(productosJson => {
            // Sincronizar de forma inteligente el JSON de Python con la sesión del navegador
            INVENTARIO_GLOBAL = productosJson.map(prodJson => {
                // Buscamos si el cliente tiene este producto actualmente en su carrito
                const itemEnCarrito = carrito.find(c => c.codigo === prodJson.codigo);
                const cantidadEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;

                // 🌟 SOLUCIÓN: El stock base SIEMPRE será el que pusiste en Python. 
                // Solo le restamos lo que el usuario tenga metido en su carrito en este instante.
                let stockActualizado = prodJson.stock - cantidadEnCarrito;

                return {
                    ...prodJson,
                    stock: stockActualizado >= 0 ? stockActualizado : 0
                };
            });

            // Guardamos el estado limpio en el almacenamiento local
            localStorage.setItem('inventario_tienda', JSON.stringify(INVENTARIO_GLOBAL));
            
            // Renderizar el catálogo con los datos frescos
            filtrarCatalogo();
        })
        .catch(error => {
            console.error('Error al cargar el inventario desde productos.json:', error);
            // Si falla el archivo, usar el respaldo local
            if (inventarioLocal.length > 0) {
                INVENTARIO_GLOBAL = inventarioLocal;
                filtrarCatalogo();
            }
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
        const itemEnCarrito = carrito.find(c => c.codigo === prod.codigo);
        const cantidadAgregada = itemEnCarrito ? itemEnCarrito.cantidad : 0;
        const stockDisponibleReal = prod.stock - cantidadAgregada;

        const esAgotado = stockDisponibleReal <= 0;
        const textoStock = esAgotado ? 'Agotado' : `Disponibles: ${stockDisponibleReal}`;
        const claseStock = esAgotado ? 'producto-stock agotado' : 'producto-stock';
        
        let rutaImagen = prod.imagen;
        if (rutaImagen && (rutaImagen.includes('/') || rutaImagen.includes('\\'))) {
            rutaImagen = "imagenes_productos/" + rutaImagen.split(/[/\\\\]/).pop();
        } else if (!rutaImagen) {
            rutaImagen = "https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=300&auto=format&fit=crop";
        }

        const articuloLimpio = prod.articulo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        contenedor.innerHTML += `
            <div class="producto-card">
                <div>
                    <div class="producto-codigo">CÓDIGO: ${prod.codigo}</div>
                    <div class="img-wrapper">
                        <img src="${rutaImagen}" alt="${articuloLimpio}" onerror="this.onerror=null; this.src='https://placehold.co/300?text=${encodeURIComponent(articuloLimpio)}'">
                    </div>
                    <h3>${articuloLimpio}</h3>
                    <div class="${claseStock}">${textoStock}</div>
                    <p style="color: var(--primary-light); font-weight: 700; font-size: 18px; margin: 0 0 8px 0;">${formatearDinero(prod.precio)}</p>
                </div>
                <button class="btn" data-codigo="${prod.codigo}" ${esAgotado ? 'disabled' : ''}>
                    ${esAgotado ? 'Sin existencias' : 'Agregar al Carrito'}
                </button>
            </div>
        `;
    });

    contenedor.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const codigo = e.target.getAttribute('data-codigo');
            agregarAlCarrito(codigo);
        });
    });
}

function filtrarCatalogo() {
    const textoBusqueda = document.getElementById('buscador').value.toLowerCase().trim();
    const productosFiltrados = INVENTARIO_GLOBAL.filter(prod => {
        const nombreValido = prod.articulo ? prod.articulo.toLowerCase() : "";
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

    const itemEnCarrito = carrito.find(item => item.codigo === codigo);
    const cantidadActual = itemEnCarrito ? itemEnCarrito.cantidad : 0;

    if (producto.stock > cantidadActual) {
        if (itemEnCarrito) {
            itemEnCarrito.cantidad += 1;
        } else {
            carrito.push({ codigo: codigo, cantidad: 1 });
        }
        guardarCarritoEnLocalStorage(); 
        actualizarCarritoVisual();
        filtrarCatalogo();
    } else {
        alert("Lo sentimos, ya no quedan más unidades.");
    }
}

function cambiarCantidad(codigo, cambio) {
    const producto = INVENTARIO_GLOBAL.find(p => p.codigo === codigo);
    const itemEnCarrito = carrito.find(item => item.codigo === codigo);
    if (!itemEnCarrito || !producto) return;

    if (cambio === 1) {
        if (producto.stock > itemEnCarrito.cantidad) {
            itemEnCarrito.cantidad += 1;
        } else {
            alert("Lo sentimos, ya no quedan más unidades.");
        }
    } else if (cambio === -1) {
        itemEnCarrito.cantidad -= 1;
        if (itemEnCarrito.cantidad <= 0) {
            const index = carrito.findIndex(item => item.codigo === codigo);
            if (index !== -1) carrito.splice(index, 1);
        }
    }
    guardarCarritoEnLocalStorage(); 
    actualizarCarritoVisual();
    filtrarCatalogo();
}

function vaciarCarrito() {
    if (confirm("¿Estás seguro de vaciar el pedido?")) {
        carrito = [];
        guardarCarritoEnLocalStorage(); 
        actualizarCarritoVisual();
        filtrarCatalogo();
    }
}

function actualizarCarritoVisual() {
    const contenedor = document.getElementById('items-carrito');
    const txtMonto = document.getElementById('total-monto');
    const btnVaciar = document.getElementById('btn-vaciar');
    const badgeContador = document.getElementById('badge-contador');
    
    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    if (badgeContador) badgeContador.innerText = totalItems;
    
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
        
        const subtotal = prod.precio * item.cantidad;
        totalGeneral += subtotal;
        const sinStockMas = prod.stock <= item.cantidad;
        
        contenedor.innerHTML += `
            <div class="item-linea">
                <div class="item-info">
                    <span class="item-nombre">[${prod.codigo}] ${prod.articulo}</span>
                    <span class="item-precio">${formatearDinero(prod.precio)} c/u</span>
                </div>
                <div class="item-controles">
                    <button class="btn-qty" data-codigo="${prod.codigo}" data-action="decrease">-</button>
                    <span class="item-cant">${item.cantidad}</span>
                    <button class="btn-qty" data-codigo="${prod.codigo}" data-action="increase" ${sinStockMas ? 'disabled' : ''}>+</button>
                </div>
            </div>
        `;
    });
    
    contenedor.querySelectorAll('.btn-qty').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const codigo = e.target.getAttribute('data-codigo');
            const action = e.target.getAttribute('data-action');
            cambiarCantidad(codigo, action === 'increase' ? 1 : -1);
        });
    });
    
    if (txtMonto) txtMonto.innerText = formatearDinero(totalGeneral);
}

function enviarPedidoFinal() {
    // 1. Enviar a Python para descuento automático
    carrito.forEach(item => {
        fetch('http://127.0.0.1:5000/registrar_venta', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                codigo: item.codigo, 
                cantidad: item.cantidad 
            })
        }).catch(err => console.error("Error al registrar venta en servidor local:", err));
    });

    // 2. Construir mensaje de WhatsApp (tu lógica actual)
    // ...
    alert("Pedido enviado. Inventario sincronizado.");
    finalizarProcesoPedido();
}
    
    mensaje += "\n━━━━━━━━━━━━━━━━━━━━━\n*TOTAL:* " + formatearDinero(total) + "\n";
    mensaje += "*FECHA DE ENTREGA:* " + formatearFechaHumana(fecha) + "\n*HORA APROX:* " + hora + "\n";
    
    urlGlobalWhatsApp = "https://wa.me/" + TELEFONO_WHATSAPP + "?text=" + window.encodeURIComponent(mensaje);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mensaje).then(() => {
            document.getElementById('alerta-copiado').style.display = 'block';
            window.open(urlGlobalWhatsApp, '_blank');
            finalizarProcesoPedido();
        }).catch(() => ejecutarCopiadoAlternativo(mensaje));
    } else {
        ejecutarCopiadoAlternativo(mensaje);
    }
}

function finalizarProcesoPedido() {
    localStorage.setItem('inventario_tienda', JSON.stringify(INVENTARIO_GLOBAL));
    carrito = []; 
    guardarCarritoEnLocalStorage(); 
    actualizarCarritoVisual(); 
    filtrarCatalogo(); 
    document.getElementById('fecha').value = '';
    document.getElementById('cliente').value = '';
}

function ejecutarCopiadoAlternativo(texto) {
    const textarea = document.createElement("textarea");
    textarea.value = texto; document.body.appendChild(textarea);
    textarea.select(); document.execCommand("copy"); document.body.removeChild(textarea);
    document.getElementById('alerta-copiado').style.display = 'block';
    window.open(urlGlobalWhatsApp, '_blank');
    finalizarProcesoPedido();
}

function abrirChatManual() { if (urlGlobalWhatsApp) window.open(urlGlobalWhatsApp, '_blank'); }