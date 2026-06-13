const TELEFONO_WHATSAPP = "527442411773"; 
let categorySeleccionada = "todas";
let INVENTARIO_GLOBAL = [];
let carrito = []; 

window.addEventListener('load', () => {
    configuringCamposFecha();
    recuperarCarritoDeLocalStorage(); 
    cargarProductos(); 
    setupEventListeners();
});

// Función con cacheBuster para evitar stock viejo
function cargarProductos() {
    const cacheBuster = new Date().getTime(); 
    fetch(`productos.json?v=${cacheBuster}`)
        .then(response => response.json())
        .then(data => {
            INVENTARIO_GLOBAL = data;
            filtrarCatalogo();
        })
        .catch(err => console.error("Error al cargar:", err));
}

function setupEventListeners() {
    document.getElementById('buscador').addEventListener('input', filtrarCatalogo);
    document.getElementById('btn-enviar-pedido').addEventListener('click', enviarPedidoFinal);
    // ... agrega aquí tus otros listeners ...
}

function enviarPedidoFinal() {
    // 1. Avisar a Python para que descuente en la BD local
    carrito.forEach(item => {
        fetch('http://127.0.0.1:5000/registrar_venta', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                codigo: item.codigo, 
                cantidad: item.cantidad 
            })
        }).catch(err => console.log("Servidor local no detectado, asegúrate de tener TIENDA DAYH.py abierto"));
    });

    // 2. Construir mensaje de WhatsApp y limpiar carrito
    // (Aquí mantén tu lógica original de construcción de mensaje)
    alert("Pedido enviado. El stock se actualizará en tu sistema local.");
    finalizarProcesoPedido();
}

function finalizarProcesoPedido() {
    localStorage.setItem('inventario_tienda', JSON.stringify(INVENTARIO_GLOBAL));
    carrito = []; 
    // ... tus otras funciones de limpieza ...
}

function filtrarCatalogo() {
    // ... tu lógica de filtrado ...
}