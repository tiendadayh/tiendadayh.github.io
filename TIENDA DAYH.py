import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog
import sqlite3
import http.server  
import json         
from http.server import HTTPServer, SimpleHTTPRequestHandler
import base64
import requests
import os
import shutil
import hashlib
import threading
from datetime import datetime
from PIL import Image, ImageTk
import winsound

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode import code128

# =========================================================
# RUTAS DE ACCESO Y CONFIGURACIÓN
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "inventario_dayh.db")
CARPETA_TICKETS = os.path.join(BASE_DIR, "tickets")
CARPETA_CORTES = os.path.join(BASE_DIR, "cortes_caja")
CARPETA_IMAGENES = os.path.join(BASE_DIR, "imagenes_productos")

os.makedirs(CARPETA_TICKETS, exist_ok=True)
os.makedirs(CARPETA_CORTES, exist_ok=True)
os.makedirs(CARPETA_IMAGENES, exist_ok=True)

# 🌟 Variable global para conectar el servidor web con la interfaz de Tkinter
INSTANCIA_APP = None

# =========================================================
# INICIALIZACIÓN DE LA BASE DE DATOS (SQLITE)
# =========================================================
def inicializar_bd():
    with sqlite3.connect(DB_PATH) as conexion:
        cursor = conexion.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS productos (
                codigo TEXT PRIMARY KEY,
                articulo TEXT NOT NULL,
                costo REAL NOT NULL,
                precio REAL NOT NULL,
                stock INTEGER NOT NULL,
                categoria TEXT,
                imagen TEXT
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                usuario TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                rol TEXT NOT NULL
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folio INTEGER NOT NULL,
                id_turno INTEGER DEFAULT 1,
                fecha TEXT NOT NULL,
                cajero TEXT NOT NULL,
                total REAL NOT NULL,
                pago REAL NOT NULL,
                cambio REAL NOT NULL,
                ganancia REAL DEFAULT 0.0
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS detalle_ventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folio_venta INTEGER NOT NULL,
                id_turno INTEGER DEFAULT 1,
                codigo_producto TEXT NOT NULL,
                articulo TEXT NOT NULL,
                cantidad INTEGER NOT NULL,
                costo_unitario REAL NOT NULL,
                precio_venta REAL NOT NULL,
                FOREIGN KEY(codigo_producto) REFERENCES productos(codigo)
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS apartados (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente TEXT NOT NULL,
                fecha TEXT NOT NULL,
                total REAL NOT NULL,
                estado TEXT DEFAULT 'PENDIENTE'
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS detalle_apartados (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                id_apartado INTEGER NOT NULL,
                codigo_producto TEXT NOT NULL,
                articulo TEXT NOT NULL,
                cantidad INTEGER NOT NULL,
                precio_venta REAL NOT NULL,
                costo_unitario REAL NOT NULL,
                FOREIGN KEY(codigo_producto) REFERENCES productos(codigo)
            )
        """)

        cursor.execute('''CREATE TABLE IF NOT EXISTS apartados_web (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente TEXT,
            telefono TEXT,
            fecha_entrega TEXT,
            hora_entrega TEXT,
            total REAL,
            detalles TEXT,
            estado TEXT,
            fecha_registro TEXT
        )''')

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS config (
                id INTEGER PRIMARY KEY,
                folio INTEGER DEFAULT 1,
                id_turno INTEGER DEFAULT 1
            )
        """)
        
        columnas_a_verificar = [
            ("ventas", "id_turno", "INTEGER DEFAULT 1"),
            ("ventas", "ganancia", "REAL DEFAULT 0.0"),
            ("detalle_ventas", "id_turno", "INTEGER DEFAULT 1"),
            ("config", "id_turno", "INTEGER DEFAULT 1")
        ]
        
        for tabla, columna, tipo in columnas_a_verificar:
            try:
                cursor.execute(f"ALTER TABLE {tabla} ADD COLUMN {columna} {tipo}")
            except sqlite3.OperationalError:
                pass
        
        cursor.execute("INSERT OR IGNORE INTO config (id, folio, id_turno) VALUES (1, 1, 1)")
        
        cursor.execute("SELECT COUNT(*) FROM usuarios")
        if cursor.fetchone()[0] == 0:
            usuarios_defecto = [
                ("admin", hashlib.sha256("1234".encode()).hexdigest(), "admin"),
                ("daria", hashlib.sha256("2026".encode()).hexdigest(), "cajero"),
                ("cajero1", hashlib.sha256("1111".encode()).hexdigest(), "cajero"),
                ("cajero2", hashlib.sha256("2222".encode()).hexdigest(), "cajero")
            ]
            cursor.executemany("INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)", usuarios_defecto)
            
        conexion.commit()

# =========================================================
# POS APP (SISTEMA PRINCIPAL) - MODO OSCURO
# =========================================================
class POSApp:
    def __init__(self, root, usuario, rol):
        global INSTANCIA_APP
        INSTANCIA_APP = self
        
        self.root = root
        self.usuario = usuario
        self.rol = rol

        self.root.title("🛒 TIENDA DAYH POS")
        self.root.configure(bg="#121212")
        self.poner_fullscreen(self.root)

        self.root.bind("<Escape>", lambda e: self.root.attributes("-fullscreen", False))
        
        self.carrito = {}
        self.total = 0
        self.folio = 1
        self.id_turno = 1
        self.imagen_actual_tk = None
        self.cache_miniaturas = {}
        
        self.ventana_web_abierta = None
        self.tabla_pedidos_web = None

        self.cargar_configuracion()
        self.crear_interfaz()
        self.actualizar_web_json()

    def actualizar_web_json(self):
        try:
            with sqlite3.connect(DB_PATH) as conexion:
                conexion.row_factory = sqlite3.Row
                cursor = conexion.cursor()
                cursor.execute("SELECT codigo, articulo, precio, stock, categoria, imagen FROM productos")
                filas = cursor.fetchall()
                
                lista_productos = []
                for fila in filas:
                    lista_productos.append({
                        "codigo": fila["codigo"],
                        "articulo": fila["articulo"],
                        "precio": float(fila["precio"]),
                        "stock": int(fila["stock"]),
                        "categoria": fila["categoria"] if fila["categoria"] else "General",
                        "imagen": fila["imagen"] if fila["imagen"] else ""
                    })
            
            ruta_json = os.path.join(BASE_DIR, "productos.json")
            with open(ruta_json, "w", encoding="utf-8") as f:
                json.dump(lista_productos, f, ensure_ascii=False, indent=4)
                
        except Exception as e:
            print(f"Error al actualizar catálogo web dinámico: {e}")
            
    def sincronizar_github(self):
        threading.Thread(target=self._hilo_sincronizar_github, daemon=True).start()

    def _hilo_sincronizar_github(self):
        try:
            ruta_token = os.path.join(BASE_DIR, "TOKE.txt")
            with open(ruta_token, "r", encoding="utf-8") as f:
                GITHUB_TOKEN = f.read().strip()
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("ERROR DE CONFIGURACIÓN", "No se encontró el archivo TOKE.txt o no se pudo leer el token."))
            return

        GITHUB_REPO = "chanecarlos83/chanecarlos83.github.io"
        GITHUB_PATH = "productos.json"
        
        self.root.after(0, lambda: self.entry_codigo.delete(0, tk.END))
        self.root.after(0, lambda: self.entry_codigo.insert(0, "Subiendo..."))

        try:
            ruta_productos = os.path.join(BASE_DIR, "productos.json")
            with open(ruta_productos, "rb") as f:
                contenido_local = f.read()
            contenido_base64 = base64.b64encode(contenido_local).decode("utf-8")

            url_api = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_PATH}"
            headers = {
                "Authorization": f"token {GITHUB_TOKEN}",
                "Accept": "application/vnd.github.v3+json"
            }
            
            respuesta_get = requests.get(url_api, headers=headers)
            sha_actual = None
            if respuesta_get.status_code == 200:
                sha_actual = respuesta_get.json()["sha"]

            datos_put = {
                "message": f"Actualización automática de inventario: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                "content": contenido_base64
            }
            if sha_actual:
                datos_put["sha"] = sha_actual

            respuesta_put = requests.put(url_api, headers=headers, json=datos_put)

            if respuesta_put.status_code in [200, 201]:
                self.root.after(0, lambda: messagebox.showinfo("ÉXITO", "Inventario sincronizado con la tienda en línea correctamente."))
            else:
                self.root.after(0, lambda: messagebox.showerror("ERROR GITHUB", f"Error al subir: {respuesta_put.status_code}\n{respuesta_put.text}"))

        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("ERROR DE CONEXIÓN", f"No se pudo sincronizar: {str(e)}"))
        finally:
            self.root.after(0, lambda: self.entry_codigo.delete(0, tk.END))

    def poner_fullscreen(self, ventana):
        ventana.update_idletasks()
        try:
            ventana.state("zoomed")
        except tk.TclError:
            ventana.attributes("-fullscreen", True)

    def actualizar_reloj(self):
        if not hasattr(self, 'fecha_hora') or not self.fecha_hora.winfo_exists():
            return
        ahora = datetime.now().strftime("%d/%m/%Y  %H:%M:%S")
        self.fecha_hora.config(text=ahora)
        self.root.after(1000, self.actualizar_reloj)

    def cargar_configuracion(self):
        try:
            with sqlite3.connect(DB_PATH) as conexion:
                cursor = conexion.cursor()
                cursor.execute("SELECT folio, id_turno FROM config WHERE id = 1")
                res = cursor.fetchone()
                if res:
                    self.folio = int(res[0])
                    self.id_turno = int(res[1])
        except Exception as e:
            messagebox.showerror("ERROR", f"No se pudo cargar la configuración:\n{e}")

    def restablecer_historial_ventas(self):
        if messagebox.askyesno("⚠️ ADVERTENCIA CRÍTICA", "ALERTA: Vas a RESTAURAR a cero todos los tickets, historial de ventas, cortes de caja y ganancias históricas.\n\nEl inventario de productos NO se borrará.\n\n¿Estás completamente seguro de continuar?"):
            if messagebox.askyesno("CONFIRMACIÓN FINAL", "Esta acción es IRREVERSIBLE.\n\n¿Deseas borrar las ventas y reiniciar los folios y ganancias a CERO?"):
                try:
                    with sqlite3.connect(DB_PATH) as conn:
                        cursor = conn.cursor()
                        cursor.execute("DELETE FROM ventas")
                        cursor.execute("DELETE FROM detalle_ventas")
                        cursor.execute("DELETE FROM sqlite_sequence WHERE name='ventas'")
                        cursor.execute("DELETE FROM sqlite_sequence WHERE name='detalle_ventas'")
                        cursor.execute("UPDATE config SET folio = 1, id_turno = 1 WHERE id = 1")
                        conn.commit()

                    self.folio = 1
                    self.id_turno = 1
                    
                    for carpeta in [CARPETA_TICKETS, CARPETA_CORTES]:
                        for archivo in os.listdir(carpeta):
                            ruta_archivo = os.path.join(carpeta, archivo)
                            try:
                                if os.path.isfile(ruta_archivo):
                                    os.remove(ruta_archivo)
                            except Exception:
                                pass
                                
                    messagebox.showinfo("ÉXITO", "El sistema de caja ha sido restaurado.\nLos tickets y ganancias se han reiniciado a cero exitosamente.")
                    self.root.destroy() 
                except Exception as e:
                    messagebox.showerror("ERROR", f"No se pudo restaurar el historial: {e}")

    def crear_interfaz(self):
        self.main_frame = tk.Frame(self.root, bg="#121212")
        self.main_frame.pack(fill="both", expand=True)

        titulo = tk.Label(self.main_frame, text="🛒 TIENDA DAYH", font=("Arial", 32, "bold"), bg="#121212", fg="white")
        titulo.pack(pady=5)

        self.fecha_hora = tk.Label(self.main_frame, font=("Arial", 14, "bold"), bg="#121212", fg="white")
        lbl_usuario = tk.Label(
            self.main_frame, 
            text=f"USUARIO: {self.usuario.upper()} | ROL: {self.rol.upper()} | TURNO: #{self.id_turno}", 
            font=("Arial", 12, "bold"), bg="#121212", fg="#00ff90"
        )
        lbl_usuario.pack()
        self.fecha_hora.place(relx=0.99, y=10, anchor="ne")
        self.actualizar_reloj()

        top = tk.Frame(self.main_frame, bg="#121212")
        top.pack(fill="x", padx=10, pady=10)

        self.entry_codigo = tk.Entry(top, font=("Arial", 16), width=8, justify="center", bg="#1e1e1e", fg="white", insertbackground="white", relief="flat")
        self.entry_codigo.pack(side="left", padx=3, ipady=10)
        self.entry_codigo.focus()
        self.entry_codigo.bind("<Return>", lambda e: self.agregar_producto())

        btn_buscar_p = tk.Button(
            top, text="🔍 BUSCAR PROD.", bg="#424242", fg="white", font=("Arial", 9, "bold"),
            width=12, height=2, relief="flat", cursor="hand2", command=self.abrir_buscador_ventas
        )
        btn_buscar_p.pack(side="left", padx=3)

        # Añadido el nuevo botón "📅GANANCIAS DÍA" a la lista
        botones = [
            ("📦NUEVO", "#2e7d32", self.nuevo_producto, "admin"),
            ("📋INVENTARIO", "#2e7d32", self.ver_inventario, "todos"),
            ("📊VALORIZACIÓN", "#2e7d32", self.ver_valorizacion_mercancia, "admin"), 
            ("📈ESTADÍSTICAS", "#2e7d32", self.ver_estadisticas, "admin"), 
            ("📅GANANCIAS DÍA", "#2e7d32", self.ver_ganancias_dia, "admin"), 
            ("✏EDITAR", "#0288d1", self.editar_producto, "admin"),
            ("📥STOCK", "#0288d1", self.surtir_stock, "admin"),
            ("🖨IMPR. CÓDIGO", "#0288d1", self.abrir_buscador_codigos, "todos"),
            ("💰CORTE CAJA", "#0288d1", self.corte_caja, "todos"),
            ("🌐SUBIR WEB", "#6a1b9a", self.sincronizar_github, "admin"),
            ("🌐PEDIDOS WEB", "#e65100", self.ver_pedidos_web, "todos"),
            ("🗓APARTADOS", "#f57c00", self.ver_apartados, "todos"),
            ("❌ELIMINAR", "#c62828", self.eliminar_producto, "admin"),
            ("⚠️RESETEAR", "#d50000", self.restablecer_historial_ventas, "admin"), 
            ("🔒SALIR", "#c62828", self.cerrar_sesion, "todos")
        ]

        frame_botones_menu = tk.Frame(top, bg="#121212")
        frame_botones_menu.pack(side="left", padx=10)

        columna_actual = 0
        fila_actual = 0
        for texto, color, comando, permission in botones:
            if permission == "todos" or self.rol == "admin":
                btn = tk.Button(
                    frame_botones_menu, text=texto, bg=color, fg="white", font=("Arial", 8, "bold"),
                    width=12, height=2, relief="flat", cursor="hand2", command=comando
                )
                btn.grid(row=fila_actual, column=columna_actual, padx=2, pady=2)
                
                columna_actual += 1
                # Ahora cambiamos a 8 botones por fila para que quepan los 15 perfectamente
                if columna_actual >= 8:
                    columna_actual = 0
                    fila_actual += 1

        contenedor_central = tk.Frame(self.main_frame, bg="#121212")
        contenedor_central.pack(fill="both", expand=True, padx=20, pady=5)

        frame_tabla = tk.Frame(contenedor_central, bg="#1e1e1e")
        frame_tabla.pack(side="left", fill="both", expand=True)

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Treeview", background="#1e1e1e", foreground="white", fieldbackground="#1e1e1e", rowheight=35, font=("Arial", 13))
        style.configure("Treeview.Heading", background="#2d2d2d", foreground="white", font=("Arial", 13, "bold"))

        columnas = ("Codigo", "Articulo", "Cantidad", "Precio", "Subtotal")
        self.tree = ttk.Treeview(frame_tabla, columns=columnas, show="headings")

        for col in columnas:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=150, anchor="center")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.mostrar_imagen_seleccionada)

        self.frame_visor = tk.LabelFrame(contenedor_central, text=" Visualización del Producto ", bg="#1e1e1e", fg="white", font=("Arial", 12, "bold"), width=320)
        self.frame_visor.pack(side="right", fill="y", padx=(15, 0))
        self.frame_visor.pack_propagate(False)

        self.lbl_imagen_visor = tk.Label(self.frame_visor, bg="#121212", text="Sin imagen\nseleccionada", fg="grey", font=("Arial", 14))
        self.lbl_imagen_visor.pack(fill="both", expand=True, padx=15, pady=15)

        footer = tk.Frame(self.main_frame, bg="#121212", height=140)
        footer.pack(side="bottom", fill="x")
        footer.pack_propagate(False)

        botones_footer = tk.Frame(footer, bg="#121212")
        botones_footer.pack(side="left", padx=30, pady=15)

        btn_quitar = tk.Button(botones_footer, text="➖ QUITAR\nPRODUCTO", font=("Arial", 15, "bold"), bg="#ff5722", fg="white", width=14, height=2, relief="flat", justify="center", anchor="center", command=self.eliminar_producto_carrito)
        btn_quitar.pack(side="left", padx=10)

        btn_borrar = tk.Button(botones_footer, text="🗑 VACIAR\nCARRITO", font=("Arial", 15, "bold"), bg="#d50000", fg="white", width=14, height=2, relief="flat", justify="center", anchor="center", command=self.borrar_carrito)
        btn_borrar.pack(side="left", padx=10)

        btn_apartar = tk.Button(botones_footer, text="🗓️ APARTAR\nPEDIDO", font=("Arial", 15, "bold"), bg="#ff9800", fg="white", width=14, height=2, relief="flat", justify="center", anchor="center", command=self.apartar_pedido)
        btn_apartar.pack(side="left", padx=10)

        btn_cobrar = tk.Button(botones_footer, text="💵 COBRAR", font=("Arial", 15, "bold"), bg="#00c853", fg="white", width=14, height=2, relief="flat", justify="center", anchor="center", command=self.cobrar)
        btn_cobrar.pack(side="left", padx=10)

        self.lbl_total = tk.Label(footer, text="TOTAL: $0.00", font=("Arial", 42, "bold"), bg="#121212", fg="#ff3d00")
        self.lbl_total.pack(side="right", padx=40, pady=20)

    # =========================================================
    # NUEVA FUNCIÓN: GANANCIAS POR DÍA Y CATEGORÍA
    # =========================================================
    def ver_ganancias_dia(self):
        ventana_ganancias = tk.Toplevel(self.root)
        ventana_ganancias.title("📅 REPORTE DE GANANCIAS: DÍA Y CATEGORÍA")
        ventana_ganancias.configure(bg="#121212")
        self.poner_fullscreen(ventana_ganancias)
        
        ventana_ganancias.lift()
        ventana_ganancias.focus_force()
        ventana_ganancias.grab_set()
        ventana_ganancias.bind("<Escape>", lambda e: ventana_ganancias.destroy())

        tk.Label(ventana_ganancias, text="📅 REPORTE DE GANANCIAS POR DÍA Y CATEGORÍA", font=("Arial", 22, "bold"), bg="#121212", fg="white").pack(pady=20)

        frame_tabla = tk.Frame(ventana_ganancias, bg="#1e1e1e")
        frame_tabla.pack(fill="both", expand=True, padx=40, pady=10)

        style_gan = ttk.Style()
        style_gan.configure("Gan.Treeview", background="#1e1e1e", foreground="white", fieldbackground="#1e1e1e", rowheight=35, font=("Arial", 12))
        style_gan.configure("Gan.Treeview.Heading", background="#2d2d2d", foreground="white", font=("Arial", 12, "bold"))

        columnas = ("Fecha (Día)", "Categoría", "Total Piezas Vendidas", "Ganancia Neta Obtenida")
        tabla_ganancias = ttk.Treeview(frame_tabla, columns=columnas, show="headings", style="Gan.Treeview")
        
        scroll_y = ttk.Scrollbar(frame_tabla, orient="vertical", command=tabla_ganancias.yview)
        tabla_ganancias.configure(yscrollcommand=scroll_y.set)
        scroll_y.pack(side="right", fill="y")
        tabla_ganancias.pack(side="left", fill="both", expand=True)

        anchos = [150, 300, 200, 250]
        for col, ancho in zip(columnas, anchos):
            tabla_ganancias.heading(col, text=col)
            tabla_ganancias.column(col, anchor="center", width=ancho)

        # Consulta SQL adaptada al formato exacto de tu DB (FECHA formato dd/mm/yyyy hh:mm:ss)
        query = """
            SELECT 
                SUBSTR(v.fecha, 1, 10) AS dia,
                COALESCE(p.categoria, 'General') AS categoria,
                SUM(dv.cantidad) AS total_piezas,
                SUM((dv.precio_venta - dv.costo_unitario) * dv.cantidad) AS ganancia_total
            FROM detalle_ventas dv
            JOIN ventas v ON v.folio = dv.folio_venta AND v.id_turno = dv.id_turno
            JOIN productos p ON p.codigo = dv.codigo_producto
            GROUP BY dia, categoria
            ORDER BY 
                SUBSTR(v.fecha, 7, 4) DESC, 
                SUBSTR(v.fecha, 4, 2) DESC, 
                SUBSTR(v.fecha, 1, 2) DESC, 
                ganancia_total DESC
        """

        try:
            with sqlite3.connect(DB_PATH) as conexion:
                cursor = conexion.cursor()
                cursor.execute(query)
                registros = cursor.fetchall()

            for registro in registros:
                dia = registro[0]
                categoria = registro[1]
                piezas = registro[2]
                ganancia = f"${registro[3]:.2f}" if registro[3] is not None else "$0.00"
                
                tabla_ganancias.insert("", "end", values=(dia, categoria, piezas, ganancia))
                
        except Exception as e:
            messagebox.showerror("ERROR", f"No se pudo generar el reporte:\n{e}", parent=ventana_ganancias)

        btn_salir = tk.Button(ventana_ganancias, text="❌ CERRAR REPORTE (ESC)", font=("Arial", 12, "bold"), bg="#333333", fg="white", relief="flat", height=2, command=ventana_ganancias.destroy)
        btn_salir.pack(fill="x", padx=40, pady=20)

    def refrescar_desde_web(self):
        print("[WEB] ¡Sincronizando nuevo pedido recibido!")
        
        self.actualizar_web_json()
        
        if self.ventana_web_abierta and self.ventana_web_abierta.winfo_exists() and self.tabla_pedidos_web:
            self.refrescar_datos_apartados()
            
        try:
            winsound.PlaySound("SystemAsterisk", winsound.SND_ALIAS | winsound.SND_ASYNC)
        except:
            pass
            
        self.root.after(0, lambda: messagebox.showinfo(
            "🛒 ¡Nuevo Pedido Web!", 
            "¡Acabas de recibir un nuevo apartado desde la página web!\n\nEl inventario y las tablas se han actualizado automáticamente."
        ))

    def ver_pedidos_web(self):
        if self.ventana_web_abierta and self.ventana_web_abierta.winfo_exists():
            self.ventana_web_abierta.lift()
            return
            
        self.ventana_web_abierta = tk.Toplevel(self.root)
        self.ventana_web_abierta.title("📦 GESTIÓN DE APARTADOS WEB")
        self.ventana_web_abierta.configure(bg="#1a1a1a")
        self.poner_fullscreen(self.ventana_web_abierta)
        self.ventana_web_abierta.bind("<Escape>", lambda e: self.ventana_web_abierta.destroy())
        
        self.ventana_web_abierta.lift()
        self.ventana_web_abierta.focus_force()
        self.ventana_web_abierta.grab_set()

        lbl_titulo = tk.Label(self.ventana_web_abierta, text="📋 REGISTRO DE PEDIDOS DESDE LA WEB", font=("Segoe UI", 16, "bold"), bg="#1a1a1a", fg="#a855f7")
        lbl_titulo.pack(pady=15)
        
        frame_tabla = tk.Frame(self.ventana_web_abierta, bg="#1e1e1e")
        frame_tabla.pack(fill="both", expand=True, padx=20, pady=10)

        columnas = ("ID", "Cliente", "Teléfono", "Fecha Ent.", "Hora Ent.", "Total", "Estado")
        self.tabla_pedidos_web = ttk.Treeview(frame_tabla, columns=columnas, show="headings", height=14)
        
        for col in columnas:
            self.tabla_pedidos_web.heading(col, text=col)
            self.tabla_pedidos_web.column(col, width=100, anchor="center")
        
        self.tabla_pedidos_web.column("Cliente", width=160, anchor="w")
        self.tabla_pedidos_web.pack(fill="both", expand=True)
                
        self.tabla_pedidos_web.tag_configure("pendiente", background="#374151", foreground="#f9fafb")
        self.tabla_pedidos_web.tag_configure("entregado", background="#10b981", foreground="#ffffff")

        def cambiar_a_entregado():
            seleccion = self.tabla_pedidos_web.selection()
            if not seleccion:
                messagebox.showwarning("Atención", "Por favor, selecciona un apartado de la lista.", parent=self.ventana_web_abierta)
                return
                
            datos = self.tabla_pedidos_web.item(seleccion[0], "values")
            id_registro = datos[0]
            estatus = datos[6]
            
            if estatus == "Entregado":
                messagebox.showinfo("Aviso", "Este pedido ya ha sido entregado.", parent=self.ventana_web_abierta)
                return
                
            if messagebox.askyesno("Confirmación", f"¿Deseas marcar el pedido de '{datos[1]}' como ENTREGADO?", parent=self.ventana_web_abierta):
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("UPDATE apartados_web SET estado = 'Entregado' WHERE id = ?", (id_registro,))
                conn.commit()
                conn.close()
                
                ruta_json_apartados = os.path.join(BASE_DIR, "pedidos_apartados.json")
                if os.path.exists(ruta_json_apartados):
                    try:
                        with open(ruta_json_apartados, "r", encoding="utf-8") as f:
                            lista = json.load(f)
                        for item in lista:
                            if str(item.get("id")) == str(id_registro) and item.get("estado", "Pendiente") != "Entregado":
                                item["estado"] = "Entregado"
                                break
                        with open(ruta_json_apartados, "w", encoding="utf-8") as f:
                            json.dump(lista, f, indent=4, ensure_ascii=False)
                    except Exception as e:
                        print(f"No se pudo actualizar el JSON: {e}")
                
                messagebox.showinfo("Éxito", "Apartado completado correctamente.", parent=self.ventana_web_abierta)
                self.refrescar_datos_apartados()

        def limpiar_pedidos_web():
            if messagebox.askyesno("Confirmación Crítica", "⚠️ ¿Estás seguro de que deseas ELIMINAR TODOS los pedidos web?\n\nEsta acción borrará el historial por completo y NO se puede deshacer.", parent=self.ventana_web_abierta):
                try:
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute("DELETE FROM apartados_web")
                    conn.commit()
                    conn.close()
                    
                    ruta_json = os.path.join(BASE_DIR, "pedidos_apartados.json")
                    if os.path.exists(ruta_json):
                        with open(ruta_json, "w", encoding="utf-8") as f:
                            json.dump([], f)

                    self.refrescar_datos_apartados()
                    messagebox.showinfo("Éxito", "Todos los pedidos web han sido limpiados de la base de datos.", parent=self.ventana_web_abierta)
                except Exception as e:
                    messagebox.showerror("Error", f"No se pudo limpiar la tabla: {e}", parent=self.ventana_web_abierta)

        frame_btn = tk.Frame(self.ventana_web_abierta, bg="#1a1a1a")
        frame_btn.pack(pady=15)
        
        tk.Button(frame_btn, text="🔄 Actualizar Tabla", command=self.refrescar_datos_apartados, bg="#374151", fg="white", font=("Segoe UI", 11, "bold"), relief="flat").grid(row=0, column=0, padx=10, pady=5)
        tk.Button(frame_btn, text="✅ Registrar Entrega", command=cambiar_a_entregado, bg="#10b981", fg="white", font=("Segoe UI", 11, "bold"), relief="flat").grid(row=0, column=1, padx=10, pady=5)
        tk.Button(frame_btn, text="🗑 Limpiar Pedidos", command=limpiar_pedidos_web, bg="#d50000", fg="white", font=("Segoe UI", 11, "bold"), relief="flat").grid(row=0, column=2, padx=10, pady=5)
        
        self.refrescar_datos_apartados()

    def refrescar_datos_apartados(self):
        if not hasattr(self, 'tabla_pedidos_web') or not self.tabla_pedidos_web:
            return
            
        for item in self.tabla_pedidos_web.get_children():
            self.tabla_pedidos_web.delete(item)
            
        ruta_pedidos_json = os.path.join(BASE_DIR, "pedidos_apartados.json")
        
        if os.path.exists(ruta_pedidos_json):
            try:
                with open(ruta_pedidos_json, "r", encoding="utf-8") as f:
                    pedidos = json.load(f)
                    
                for p in pedidos:
                    estado_actual = p.get("estado", "Pendiente")
                    tag_fila = "entregado" if estado_actual == "Entregado" else "pendiente"
                    
                    self.tabla_pedidos_web.insert("", "end", values=(
                        p.get("id", ""),
                        p.get("cliente", "Sin Nombre"),
                        p.get("telefono", ""),
                        p.get("fecha_entrega", ""),
                        p.get("hora_entrega", ""),
                        f"${float(p.get('total', 0.0)):.2f}",
                        estado_actual
                    ), tags=(tag_fila,))
            except Exception as e:
                print(f"[ERROR UI] No se pudo leer el JSON para mostrar en pantalla: {e}")

    def guardar_pedido_desde_web(self, datos_pedido):
        try:
            conexion = sqlite3.connect(DB_PATH)
            cursor = conexion.cursor()
            
            productos_solicitados = datos_pedido.get('productos', [])
            total_pedido = 0.0
            detalles_lista = []
            
            for prod in productos_solicitados:
                codigo = prod.get('codigo')
                cantidad = int(prod.get('cantidad', 0))
                
                cursor.execute("SELECT stock, articulo, precio FROM productos WHERE codigo = ?", (codigo,))
                fila = cursor.fetchone()
                if fila:
                    stock_actual, nombre_articulo, precio = fila
                    nuevo_stock = max(0, stock_actual - cantidad)
                    
                    cursor.execute("UPDATE productos SET stock = ? WHERE codigo = ?", (nuevo_stock, codigo))
                    
                    total_pedido += (precio * cantidad)
                    detalles_lista.append(f"{nombre_articulo} (x{cantidad})")
            
            texto_detalles = ", ".join(detalles_lista) if detalles_lista else "Pedido vacío"
            conexion.commit()
            conexion.close()
            
            ruta_pedidos_json = os.path.join(BASE_DIR, "pedidos_apartados.json")
            pedidos_existentes = []
            
            if os.path.exists(ruta_pedidos_json):
                try:
                    with open(ruta_pedidos_json, "r", encoding="utf-8") as f:
                        pedidos_existentes = json.load(f)
                        if not isinstance(pedidos_existentes, list):
                            pedidos_existentes = []
                except:
                    pedidos_existentes = []
            
            nuevo_pedido_json = {
                "id": len(pedidos_existentes) + 1,
                "cliente": datos_pedido.get('cliente', 'Cliente Web'),
                "telefono": datos_pedido.get('telefono', ''),
                "fecha_entrega": datos_pedido.get('fecha_entrega'),
                "hora_entrega": datos_pedido.get('hora_entrega'),
                "total": total_pedido,
                "detalles": texto_detalles,
                "productos": productos_solicitados,
                "estado": "Pendiente",
                "fecha_registro": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            
            pedidos_existentes.append(nuevo_pedido_json)
            
            with open(ruta_pedidos_json, "w", encoding="utf-8") as f:
                json.dump(pedidos_existentes, f, ensure_ascii=False, indent=4)
            print(f"[JSON] ¡Pedido guardado con éxito en pedidos_apartados.json!")

            try:
                conexion = sqlite3.connect(DB_PATH)
                cursor = conexion.cursor()
                cursor.execute("""
                    INSERT INTO apartados_web (cliente, telefono, fecha_entrega, hora_entrega, total, detalles, estado, fecha_registro) 
                    VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?)
                """, (
                    datos_pedido.get('cliente', 'Cliente Web'),
                    datos_pedido.get('telefono', ''),
                    datos_pedido.get('fecha_entrega'),
                    datos_pedido.get('hora_entrega'),
                    total_pedido,
                    texto_detalles,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ))
                conexion.commit()
                conexion.close()
            except Exception as e_bd:
                print(f"[AVISO BD] No se insertó en SQLite: {e_bd}")

            self.root.after(0, lambda: ejecutar_sincronizacion_total_web(self))

        except Exception as e:
            print(f"[ERROR BD] No se pudo procesar pedido: {e}")

    def ver_estadisticas(self):
        ventana_stats = tk.Toplevel(self.root)
        ventana_stats.title("📊 ESTADÍSTICAS DE VENTA")
        ventana_stats.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_stats)
        ventana_stats.bind("<Escape>", lambda e: ventana_stats.destroy())
        
        ventana_stats.lift()
        ventana_stats.focus_force()
        ventana_stats.grab_set()

        lbl_titulo = tk.Label(ventana_stats, text="Rendimiento de Ventas por Categoría", font=("Segoe UI", 16, "bold"), bg="#1a1a1a", fg="#a855f7")
        lbl_titulo.pack(pady=15)
        
        canvas_grafica = tk.Canvas(ventana_stats, width=500, height=300, bg="#1f2937", highlightbackground="#374151")
        canvas_grafica.pack(pady=10)
        
        def dibujar_grafica():
            canvas_grafica.delete("all")
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT categoria, COUNT(*), SUM(precio * stock) FROM productos GROUP BY categoria")
            datos = cursor.fetchall()
            conn.close()
            
            if not datos:
                canvas_grafica.create_text(250, 150, text="No hay datos de inventario suficientes.", fill="#9ca3af", font=("Segoe UI", 12))
                return
                
            max_valor = max([row[1] for row in datos]) if datos else 1
            x_inicial = 50
            ancho_barra = 40
            espacio = 30
            
            for i, row in enumerate(datos):
                cat_nombre = row[0] if row[0] else "Sin Cat."
                cantidad = row[1]
                altura_barra = (cantidad / max_valor) * 200
                x1 = x_inicial + i * (ancho_barra + espacio)
                y1 = 250 - altura_barra
                x2 = x1 + ancho_barra
                y2 = 250
                
                canvas_grafica.create_rectangle(x1, y1, x2, y2, fill="#a855f7", outline="#c084fc", width=1)
                canvas_grafica.create_text(x1 + (ancho_barra/2), y1 - 10, text=str(cantidad), fill="#f9fafb", font=("Segoe UI", 9, "bold"))
                canvas_grafica.create_text(x1 + (ancho_barra/2), y2 + 15, text=cat_nombre[:8], fill="#9ca3af", font=("Segoe UI", 8))
        
        btn_actualizar = tk.Button(ventana_stats, text="🔄 Actualizar Gráficos", command=dibujar_grafica, bg="#a855f7", fg="white", font=("Segoe UI", 11, "bold"), relief="flat", padx=8, pady=8)
        btn_actualizar.pack(pady=10)
        dibujar_grafica()

    def cerrar_sesion(self):
        if self.carrito:
            if not messagebox.askyesno("CONFIRMAR", "Tienes productos en el carrito. ¿Seguro que deseas cerrar sesión?"):
                self.entry_codigo.focus()
                return
        if messagebox.askyesno("CERRAR SESIÓN", "¿Deseas salir del usuario actual?"):
            self.main_frame.destroy()  
            Login(self.root)          

    def ver_valorizacion_mercancia(self):
        ventana_val = tk.Toplevel(self.root)
        ventana_val.title("📊 REPORTE FINANCIERO Y CONTROL DE GANANCIAS")
        ventana_val.configure(bg="#121212")
        self.poner_fullscreen(ventana_val) 
        
        ventana_val.lift()
        ventana_val.focus_force()
        ventana_val.grab_set()
        ventana_val.bind("<Escape>", lambda e: ventana_val.destroy())

        tk.Label(ventana_val, text="📊 RENDIMIENTO, COSTOS Y GANANCIAS EN COMPRAS", font=("Arial", 22, "bold"), bg="#121212", fg="white").pack(pady=15)

        frame_tarjetas = tk.Frame(ventana_val, bg="#121212")
        frame_tarjetas.pack(fill="x", padx=40, pady=10)

        try:
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT SUM(stock * costo) FROM productos")
                total_inversion = cursor.fetchone()[0] or 0.0

                cursor.execute("SELECT SUM(stock * precio) FROM productos")
                total_valor_venta = cursor.fetchone()[0] or 0.0

                cursor.execute("SELECT SUM(ganancia) FROM ventas")
                ganancias_reales_obtenidas = cursor.fetchone()[0] or 0.0

                cursor.execute("SELECT codigo, articulo, costo, precio, stock, (stock * costo), (stock * precio), (stock * (precio - costo)) FROM productos")
                productos_lista = cursor.fetchall()
        except Exception as e:
            messagebox.showerror("ERROR", f"No se pudo consultar la base de datos: {e}", parent=ventana_val)
            ventana_val.destroy()
            return

        t1 = tk.Frame(frame_tarjetas, bg="#1e1e1e", bd=1, relief="solid", width=280, height=100)
        t1.pack_propagate(False)
        t1.pack(side="left", expand=True, padx=10)
        tk.Label(t1, text="INVERSIÓN ACTUAL EN STOCK", font=("Arial", 11, "bold"), bg="#1e1e1e", fg="#b0bec5").pack(pady=5)
        tk.Label(t1, text=f"${total_inversion:,.2f} MXN", font=("Arial", 16, "bold"), bg="#1e1e1e", fg="#ffb74d").pack()

        t2 = tk.Frame(frame_tarjetas, bg="#1e1e1e", bd=1, relief="solid", width=280, height=100)
        t2.pack_propagate(False)
        t2.pack(side="left", expand=True, padx=10)
        tk.Label(t2, text="VALOR TOTAL DE ALMACÉN", font=("Arial", 11, "bold"), bg="#1e1e1e", fg="#b0bec5").pack(pady=5)
        tk.Label(t2, text=f"${total_valor_venta:,.2f} MXN", font=("Arial", 16, "bold"), bg="#1e1e1e", fg="#29b6f6").pack()

        t3 = tk.Frame(frame_tarjetas, bg="#1e1e1e", bd=1, relief="solid", width=280, height=100)
        t3.pack_propagate(False)
        t3.pack(side="left", expand=True, padx=10)
        tk.Label(t3, text="⭐ GANANCIAS HISTÓRICAS TOTALES", font=("Arial", 11, "bold"), bg="#1e1e1e", fg="#00ff90").pack(pady=5)
        tk.Label(t3, text=f"${ganancias_reales_obtenidas:,.2f} MXN", font=("Arial", 16, "bold"), bg="#1e1e1e", fg="#00c853").pack()

        tk.Label(ventana_val, text="📋 AUDITORÍA INDIVIDUAL DE ARTÍCULOS EN ALMACÉN", font=("Arial", 12, "bold"), bg="#121212", fg="white").pack(pady=(20,5))
        
        frame_tabla_val = tk.Frame(ventana_val)
        frame_tabla_val.pack(fill="both", expand=True, padx=40, pady=10)

        style_val = ttk.Style()
        style_val.configure("Val.Treeview", background="#1e1e1e", foreground="white", fieldbackground="#1e1e1e", rowheight=30, font=("Arial", 11))
        style_val.configure("Val.Treeview.Heading", background="#2d2d2d", foreground="white", font=("Arial", 11, "bold"))

        columnas_val = ("Cod", "Articulo", "Costo U.", "Precio U.", "Stock", "Inversión F.", "Venta Esperada", "Ganancia Potencial")
        tabla_val = ttk.Treeview(frame_tabla_val, columns=columnas_val, show="headings", style="Val.Treeview")
        scroll_val = ttk.Scrollbar(frame_tabla_val, orient="vertical", command=tabla_val.yview)
        tabla_val.configure(yscrollcommand=scroll_val.set)
        
        scroll_val.pack(side="right", fill="y")
        tabla_val.pack(side="left", fill="both", expand=True)

        anchos = [90, 180, 95, 95, 70, 110, 110, 110]
        for col, ancho in zip(columnas_val, anchos):
            tabla_val.heading(col, text=col)
            tabla_val.column(col, anchor="center", width=ancho)

        tabla_val.tag_configure("critico", background="#b71c1c", foreground="white")

        for fila in productos_lista:
            tag = "critico" if fila[4] <= 1 else ""
            tabla_val.insert("", "end", values=(
                fila[0], fila[1], 
                f"${fila[2]:.2f}", f"${fila[3]:.2f}", 
                fila[4], 
                f"${fila[5]:.2f}", f"${fila[6]:.2f}", f"${fila[7]:.2f}"
            ), tags=(tag,))

        btn_salir = tk.Button(ventana_val, text="❌ CERRAR REPORTE (ESC)", font=("Arial", 12, "bold"), bg="#333333", fg="white", relief="flat", height=2, command=ventana_val.destroy)
        btn_salir.pack(fill="x", padx=40, pady=20)

    def cobrar(self):
        if self.total <= 0:
            messagebox.showwarning("VACÍO", "No hay productos en el carrito")
            return

        ventana_cobro = tk.Toplevel(self.root)
        ventana_cobro.title("💵 PROCESAR COBRO")
        ventana_cobro.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_cobro) 
        
        ventana_cobro.lift()
        ventana_cobro.focus_force()
        ventana_cobro.grab_set()
        ventana_cobro.bind("<Escape>", lambda e: ventana_cobro.destroy())

        main_box = tk.Frame(ventana_cobro, bg="#212121", bd=1, relief="solid")
        main_box.pack(expand=True, padx=25, pady=25) 

        tk.Label(main_box, text="RESUMEN DE COMPRA", bg="#212121", fg="#00ff90", font=("Arial", 14, "bold")).pack(pady=12)
        
        frame_scroll = tk.Frame(main_box, bg="#121212")
        frame_scroll.pack(fill="x", padx=20, pady=5)
        
        canvas_f = tk.Canvas(frame_scroll, bg="#121212", height=110, highlightthickness=0)
        scrollbar_h = tk.Scrollbar(frame_scroll, orient="horizontal", command=canvas_f.xview)
        frame_fotos_cobro = tk.Frame(canvas_f, bg="#121212")
        
        frame_fotos_cobro.bind("<Configure>", lambda e: canvas_f.configure(scrollregion=canvas_f.bbox("all")))
        canvas_f.create_window((0,0), window=frame_fotos_cobro, anchor="nw")
        canvas_f.configure(xscrollcommand=scrollbar_h.set)
        
        canvas_f.pack(fill="x", expand=True)
        scrollbar_h.pack(fill="x")

        self.miniaturas_tk = []
        for cod_prod in self.carrito.keys():
            if cod_prod in self.cache_miniaturas:
                self.miniaturas_tk.append(self.cache_miniaturas[cod_prod])
                lbl_m = tk.Label(frame_fotos_cobro, image=self.cache_miniaturas[cod_prod], bg="#121212", bd=1, relief="groove")
                lbl_m.pack(side="left", padx=6, pady=5)
                continue
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT imagen FROM productos WHERE codigo = ?", (cod_prod,))
                    res_img = cursor.fetchone()
                    if res_img and res_img[0] and os.path.exists(res_img[0]):
                        img_mini = Image.open(res_img[0])
                        img_mini.thumbnail((90, 90))
                        tk_mini = ImageTk.PhotoImage(img_mini)
                        self.cache_miniaturas[cod_prod] = tk_mini
                        self.miniaturas_tk.append(tk_mini)
                        
                        lbl_m = tk.Label(frame_fotos_cobro, image=tk_mini, bg="#121212", bd=1, relief="groove")
                        lbl_m.pack(side="left", padx=6, pady=5)
            except Exception:
                pass

        if not self.miniaturas_tk:
            lbl_vacio = tk.Label(frame_fotos_cobro, text="(Productos sin imágenes asignadas)", fg="grey", bg="#121212", font=("Arial", 11, "italic"))
            lbl_vacio.pack(expand=True, pady=35)

        tk.Label(main_box, text=f"TOTAL NETO: ${self.total:.2f} MXN", bg="#212121", fg="#ff3d00", font=("Arial", 24, "bold")).pack(pady=15)
        tk.Label(main_box, text="Ingrese Monto de Pago:", bg="#212121", fg="white", font=("Arial", 12, "bold")).pack()
        
        entry_pago = tk.Entry(main_box, font=("Arial", 22), justify="center", width=12, bg="#121212", fg="white", insertbackground="white", relief="flat")
        entry_pago.pack(pady=8)
        entry_pago.focus()

        def procesar_transaccion():
            try:
                pago = float(entry_pago.get().strip())
            except ValueError:
                messagebox.showerror("ERROR", "Ingrese una cantidad de dinero válida", parent=ventana_cobro)
                return

            if pago < self.total:
                messagebox.showerror("ERROR", "El pago es menor al total requerido", parent=ventana_cobro)
                return

            conexion = None
            try:
                conexion = sqlite3.connect(DB_PATH)
                cursor = conexion.cursor()
                conexion.execute("BEGIN TRANSACTION")
                
                fecha_actual = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                cambio = pago - self.total

                ganancia_ticket_total = 0.0
                for codigo, item in self.carrito.items():
                    ganancia_articulo = (item["precio"] - item["costo"]) * item["cantidad"]
                    ganancia_ticket_total += ganancia_articulo

                cursor.execute("""
                    INSERT INTO ventas (folio, id_turno, fecha, cajero, total, pago, cambio, ganancia)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (self.folio, self.id_turno, fecha_actual, self.usuario, self.total, pago, cambio, ganancia_ticket_total))

                productos_alerta_stock = []

                for codigo, item in self.carrito.items():
                    cursor.execute("""
                        INSERT INTO detalle_ventas (folio_venta, id_turno, codigo_producto, articulo, cantidad, costo_unitario, precio_venta)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (self.folio, self.id_turno, codigo, item["articulo"], item["cantidad"], item["costo"], item["precio"]))
                    
                    cursor.execute("UPDATE productos SET stock = stock - ? WHERE codigo = ?", (item["cantidad"], codigo))
                    
                    cursor.execute("SELECT stock, articulo FROM productos WHERE codigo = ?", (codigo,))
                    res_stock = cursor.fetchone()
                    if res_stock and res_stock[0] == 1:
                        productos_alerta_stock.append(res_stock[1])

                cursor.execute("UPDATE config SET folio = folio + 1 WHERE id = 1")
                conexion.commit()
                self.folio += 1 

                self.actualizar_web_json()

                ticket_texto = self.obtener_texto_ticket(fecha_actual, pago, cambio)
                self.guardar_ticket_archivo(fecha_actual, ticket_texto)

                ventana_cobro.destroy()
                self.carrito.clear()
                self.actualizar_tabla()
                
                self.mostrar_visor_ticket(ticket_texto)

                if productos_alerta_stock:
                    lista_texto = "\n- ".join(productos_alerta_stock)
                    messagebox.showinfo(
                        "⚠️ AVISO DE INVENTARIO BAJO", 
                        f"Atención: Los siguientes productos están casi agotados.\n¡Ya solo queda 1 pz en stock!\n\n- {lista_texto}"
                    )
            except Exception as e:
                if conexion:
                    conexion.rollback()
                messagebox.showerror("ERROR CRÍTICO", f"No se pudo guardar la venta:\n{e}", parent=ventana_cobro)
            finally:
                if conexion:
                    conexion.close()

        entry_pago.bind("<Return>", lambda e: procesar_transaccion())
        tk.Button(main_box, text="✔ CONFIRMAR COBRO", bg="#00c853", fg="white", font=("Arial", 13, "bold"), command=procesar_transaccion, width=22, height=2, relief="flat", cursor="hand2").pack(pady=15)

    def corte_caja(self):
        if not messagebox.askyesno("CONFIRMAR CORTE", "¿Deseas realizar el Corte de Caja?\nEsto compilará el reporte y avanzará al siguiente turno."):
            self.entry_codigo.focus()
            return

        total_ventas = 0
        total_piezas = 0
        total_ganancia_turno = 0
        resumen = "--- DETALLE DE ARTÍCULOS VENDIDOS EN EL TURNO ---\n\n"
        
        try:
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT codigo_producto, articulo, SUM(cantidad), costo_unitario, precio_venta
                    FROM detalle_ventas
                    WHERE id_turno = ?
                    GROUP BY codigo_producto
                """, (self.id_turno,))
                filas = cursor.fetchall()

                for codigo, articulo, cantidad, costo, precio in filas:
                    venta_prod = cantidad * precio
                    ganancia_prod = (precio - costo) * cantidad

                    total_ventas += venta_prod
                    total_piezas += cantidad
                    total_ganancia_turno += ganancia_prod

                    resumen += f"{articulo} (Cód: {codigo})\n  Cant. Vendida: {cantidad} pzas.\n  Ingreso: ${venta_prod:.2f} | Ganancia: ${ganancia_prod:.2f}\n\n"

            if total_piezas == 0:
                messagebox.showinfo("CORTE DE CAJA", "No se han registrado ventas en este turno aún.")
                self.entry_codigo.focus()
                return

            fecha = datetime.now().strftime("%d-%m-%Y_%H-%M-%S")
            nombre_corte = f"CORTE_TURNO_{self.id_turno}_{fecha}.txt"
            ruta_corte = os.path.join(CARPETA_CORTES, nombre_corte)

            with open(ruta_corte, "w", encoding="utf-8") as f:
                f.write("====================================\n")
                f.write(f"     CORTE DE CAJA DAYH - TURNO #{self.id_turno}\n")
                f.write("====================================\n")
                f.write(f"FECHA REPORTE: {fecha}\n")
                f.write(f"ATENDIÓ: {self.usuario.upper()}\n")
                f.write("------------------------------------\n")
                f.write(f"TOTAL PIEZAS VENDIDAS: {total_piezas}\n")
                f.write(f"VENTAS TOTALES REGISTRADAS: ${total_ventas:.2f}\n")
                f.write(f"GANANCIA TOTAL OBTENIDA:    ${total_ganancia_turno:.2f}\n")
                f.write("------------------------------------\n\n")
                f.write(resumen)
                f.write("\n====================================\n")
                f.write("       FIN DEL REPORTE DEL TURNO\n")
                f.write("====================================\n")

            self.id_turno += 1
            self.folio = 1
            
            with sqlite3.connect(DB_PATH) as conexion:
                cursor = conexion.cursor()
                cursor.execute("UPDATE config SET folio = 1, id_turno = ? WHERE id = 1", (self.id_turno,))
                conexion.commit()

            messagebox.showinfo("CORTE COMPLETO", f"REPORTE COMPILADO Y TURNO CERRADO\n\nTotal Ventas: ${total_ventas:.2f}\nGanancia Real: ${total_ganancia_turno:.2f}\n\nLos datos históricos se mantuvieron seguros.")
            self.actualizar_tabla()
        except Exception as e:
            messagebox.showerror("ERROR", f"No se pudo compilar el corte de caja: {e}")
        finally:
            self.entry_codigo.focus()

    def abrir_buscador_ventas(self):
        ventana_buscar = tk.Toplevel(self.root)
        ventana_buscar.title("🔍 BUSCADOR DE ARTÍCULOS")
        ventana_buscar.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_buscar)
        
        ventana_buscar.lift()
        ventana_buscar.focus_force()
        ventana_buscar.grab_set()
        ventana_buscar.bind("<Escape>", lambda e: ventana_buscar.destroy())

        lbl_titulo = tk.Label(ventana_buscar, text="🔍 CONSULTA DE ARTÍCULOS", font=("Segoe UI", 16, "bold"), bg="#1a1a1a", fg="#00ff90")
        lbl_titulo.pack(pady=10)

        frame_busqueda = tk.Frame(ventana_buscar, bg="#1a1a1a")
        frame_busqueda.pack(fill="x", padx=20, pady=5)

        tk.Label(frame_busqueda, text="Buscar término:", font=("Arial", 12), bg="#1a1a1a", fg="white").pack(side="left", padx=5)
        entry_termino = tk.Entry(frame_busqueda, font=("Arial", 14), width=30, bg="#2d2d2d", fg="white", insertbackground="white")
        entry_termino.pack(side="left", padx=5, ipady=3)
        entry_termino.focus()

        contenedor_central_b = tk.Frame(ventana_buscar, bg="#1a1a1a")
        contenedor_central_b.pack(fill="both", expand=True, padx=20, pady=10)

        frame_tabla_b = tk.Frame(contenedor_central_b, bg="#1e1e1e")
        frame_tabla_b.pack(side="left", fill="both", expand=True)

        columnas = ("Código", "Artículo", "Precio", "Stock", "Categoría")
        tabla_b = ttk.Treeview(frame_tabla_b, columns=columnas, show="headings", height=15)
        
        for col in columnas:
            tabla_b.heading(col, text=col)
            tabla_b.column(col, width=120, anchor="center")
        tabla_b.column("Artículo", width=250, anchor="w")
        
        scroll_b = ttk.Scrollbar(frame_tabla_b, orient="vertical", command=tabla_b.yview)
        tabla_b.configure(yscrollcommand=scroll_b.set)
        scroll_b.pack(side="right", fill="y")
        tabla_b.pack(side="left", fill="both", expand=True)

        frame_visor_b = tk.LabelFrame(contenedor_central_b, text=" Imagen del Artículo ", bg="#1e1e1e", fg="white", font=("Arial", 12, "bold"), width=300)
        frame_visor_b.pack(side="right", fill="y", padx=(15, 0))
        frame_visor_b.pack_propagate(False)

        lbl_imagen_visor_b = tk.Label(frame_visor_b, bg="#121212", text="Sin imagen\nseleccionada", fg="grey", font=("Arial", 12))
        lbl_imagen_visor_b.pack(fill="both", expand=True, padx=10, pady=10)

        self.imagen_buscador_cache = None

        def mostrar_imagen_buscador(event):
            seleccion = tabla_b.selection()
            if not seleccion:
                return
            codigo_prod = tabla_b.item(seleccion[0], "values")[0]
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT imagen FROM productos WHERE codigo = ?", (codigo_prod,))
                    res = cursor.fetchone()
                
                if res and res[0] and os.path.exists(res[0]):
                    img = Image.open(res[0])
                    img.thumbnail((260, 260))
                    img_tk = ImageTk.PhotoImage(img)
                    self.imagen_buscador_cache = img_tk
                    lbl_imagen_visor_b.config(image=img_tk, text="")
                else:
                    lbl_imagen_visor_b.config(image="", text="Producto sin foto\no no encontrada", fg="grey")
            except Exception:
                lbl_imagen_visor_b.config(image="", text="Error al cargar\nimagen", fg="red")

        tabla_b.bind("<<TreeviewSelect>>", mostrar_imagen_buscador)

        def ejecutar_busqueda(event=None):
            for item in tabla_b.get_children():
                tabla_b.delete(item)
            termino = entry_termino.get().strip()
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    if termino == "":
                        cursor.execute("SELECT codigo, articulo, precio, stock, categoria FROM productos")
                    else:
                        cursor.execute("SELECT codigo, articulo, precio, stock, categoria FROM productos WHERE codigo LIKE ? OR articulo LIKE ? OR categoria LIKE ?", 
                                       (f"%{termino}%", f"%{termino}%", f"%{termino}%"))
                    for fila in cursor.fetchall():
                        tabla_b.insert("", "end", values=(fila[0], fila[1], f"${fila[2]:.2f}", fila[3], fila[4] if fila[4] else "General"))
            except Exception as e:
                messagebox.showerror("Error", f"Error al consultar: {e}", parent=ventana_buscar)

        entry_termino.bind("<KeyRelease>", ejecutar_busqueda)

        def seleccionar_y_cerrar(event=None):
            seleccion = tabla_b.selection()
            if not seleccion:
                messagebox.showwarning("Atención", "Selecciona un producto de la lista.", parent=ventana_buscar)
                return
            codigo_prod = tabla_b.item(seleccion[0], "values")[0]
            self.entry_codigo.delete(0, tk.END)
            self.entry_codigo.insert(0, codigo_prod)
            ventana_buscar.destroy()
            self.agregar_producto()

        tabla_b.bind("<Double-1>", seleccionar_y_cerrar)

        frame_btn_b = tk.Frame(ventana_buscar, bg="#1a1a1a")
        frame_btn_b.pack(pady=15)

        btn_seleccionar = tk.Button(frame_btn_b, text="🛒 AGREGAR A VENTAS", command=seleccionar_y_cerrar, bg="#00c853", fg="white", font=("Segoe UI", 12, "bold"), relief="flat", width=22, height=2, cursor="hand2")
        btn_seleccionar.grid(row=0, column=0, padx=10)
        
        btn_cancelar = tk.Button(frame_btn_b, text="❌ CANCELAR", command=ventana_buscar.destroy, bg="#333333", fg="white", font=("Segoe UI", 12, "bold"), relief="flat", width=15, height=2, cursor="hand2")
        btn_cancelar.grid(row=0, column=1, padx=10)

        ejecutar_busqueda()

    def abrir_buscador_codigos(self):
        ventana_busc_c = tk.Toplevel(self.root)
        ventana_busc_c.title("🖨️ GENERADOR DE HOJAS DE ETIQUETAS MÚLTIPLES")
        ventana_busc_c.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_busc_c) 
        
        ventana_busc_c.lift()
        ventana_busc_c.focus_force()
        ventana_busc_c.grab_set()
        ventana_busc_c.bind("<Escape>", lambda e: ventana_busc_c.destroy())

        self.etiquetas_solicitadas = {}

        pan_izq = tk.LabelFrame(ventana_busc_c, text=" 1. Buscar Productos ", bg="#1e1e1e", fg="white", font=("Arial", 12, "bold"))
        pan_izq.pack(side="left", fill="both", expand=True, padx=15, pady=15)

        tk.Label(pan_izq, text="Filtro de Nombre:", bg="#1e1e1e", fg="white", font=("Arial", 11)).pack(pady=(10, 2))
        entry_f = tk.Entry(pan_izq, font=("Arial", 13), width=28, bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_f.pack(pady=5, ipady=4)
        entry_f.focus()

        tabla_prod = ttk.Treeview(pan_izq, columns=("Codigo", "Articulo", "Precio"), show="headings", height=10)
        for col in ("Codigo", "Articulo", "Precio"):
            tabla_prod.heading(col, text=col)
            tabla_prod.column(col, anchor="center", width=120)
        tabla_prod.pack(fill="both", expand=True, padx=15, pady=10)

        frame_control = tk.Frame(pan_izq, bg="#1e1e1e")
        frame_control.pack(fill="x", padx=15, pady=10)

        tk.Label(frame_control, text="Etiquetas a Imprimir:", bg="#1e1e1e", fg="#00ff90", font=("Arial", 11, "bold")).pack(side="left", padx=5)
        entry_cant_prod = tk.Entry(frame_control, font=("Arial", 12, "bold"), width=8, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_cant_prod.pack(side="left", padx=10, ipady=3)
        entry_cant_prod.insert(0, "1")

        pan_der = tk.LabelFrame(ventana_busc_c, text=" 2. Lista de Etiquetas a Generar ", bg="#1e1e1e", fg="white", font=("Arial", 12, "bold"))
        pan_der.pack(side="right", fill="both", expand=True, padx=15, pady=15)

        tabla_impresion = ttk.Treeview(pan_der, columns=("Codigo", "Articulo", "Precio", "Piezas"), show="headings", height=10)
        for col in ("Codigo", "Articulo", "Precio", "Piezas"):
            tabla_impresion.heading(col, text=col)
            tabla_impresion.column(col, anchor="center", width=110)
        tabla_impresion.pack(fill="both", expand=True, padx=15, pady=10)

        def filtrar_catalogo(event=None):
            for item in tabla_prod.get_children():
                tabla_prod.delete(item)
            texto = entry_f.get().strip()
            if not texto:
                return
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT codigo, articulo, precio FROM productos WHERE articulo LIKE ?", (f"%{texto}%",))
                    for fila in cursor.fetchall():
                        tabla_prod.insert("", "end", values=(fila[0], fila[1], f"${fila[2]:.2f}"))
            except Exception:
                pass

        entry_f.bind("<KeyRelease>", filtrar_catalogo)

        def actualizar_tabla_impresion():
            for item in tabla_impresion.get_children():
                tabla_impresion.delete(item)
            for cod, info in self.etiquetas_solicitadas.items():
                tabla_impresion.insert("", "end", values=(cod, info["articulo"], f"${info['precio']:.2f}", info["piezas"]))

        def agregar_a_lista_impresion(event=None):
            sel = tabla_prod.selection()
            if not sel:
                messagebox.showwarning("AVISO", "Selecciona un producto del catálogo izquierdo.", parent=ventana_busc_c)
                return
            try:
                pz = int(entry_cant_prod.get().strip())
                if pz <= 0:
                    raise ValueError()
            except ValueError:
                messagebox.showerror("ERROR", "Ingresa una cantidad de piezas entera mayor a 0.", parent=ventana_busc_c)
                return

            item = tabla_prod.item(sel[0])
            cod = str(item["values"][0])
            art = str(item["values"][1])
            prec = float(str(item["values"][2]).replace("$", ""))

            if cod in self.etiquetas_solicitadas:
                self.etiquetas_solicitadas[cod]["piezas"] += pz
            else:
                self.etiquetas_solicitadas[cod] = {"articulo": art, "precio": prec, "piezas": pz}

            actualizar_tabla_impresion()
            entry_cant_prod.delete(0, tk.END)
            entry_cant_prod.insert(0, "1")

        def quitar_de_lista_impresion():
            sel = tabla_impresion.selection()
            if not sel:
                return
            item = tabla_impresion.item(sel[0])
            cod = str(item["values"][0])
            if cod in self.etiquetas_solicitadas:
                del self.etiquetas_solicitadas[cod]
            actualizar_tabla_impresion()

        btn_add = tk.Button(frame_control, text="➕ SUMAR A LISTA", font=("Arial", 10, "bold"), bg="#00c853", fg="white", command=agregar_a_lista_impresion, relief="flat", cursor="hand2")
        btn_add.pack(side="left", padx=5)
        tabla_prod.bind("<Double-1>", agregar_a_lista_impresion)

        btn_del_list = tk.Button(pan_der, text="➖ QUITAR SELECCIONADO", font=("Arial", 10, "bold"), bg="#ff5722", fg="white", command=quitar_de_lista_impresion, relief="flat", cursor="hand2")
        btn_del_list.pack(pady=5)

        def lanzar_generacion_pdf():
            if not self.etiquetas_solicitadas:
                messagebox.showwarning("LISTA VACÍA", "Por favor, añade al menos un código y sus piezas antes de continuar.", parent=ventana_busc_c)
                return
            
            fecha_str = datetime.now().strftime("%d_%m_%Y_%H%M%S")
            nombre_sugerido = f"HOJA_ETIQUETAS_MIX_{fecha_str}.pdf"
            ruta_guardado = filedialog.asksaveasfilename(
                parent=ventana_busc_c,
                title="Guardar PDF de Etiquetas Combinadas",
                initialfile=nombre_sugerido,
                filetypes=[("Archivos PDF", "*.pdf")]
            )
            if not ruta_guardado:
                return

            try:
                ancho_hoja, alto_hoja = letter 
                ancho_etiqueta = 2.5 * cm
                alto_etiqueta = 1.5 * cm
                
                margen_x = 1.0 * cm
                margen_y = 1.2 * cm
                espacio_x = 0.3 * cm
                espacio_y = 0.3 * cm
                
                pdf = canvas.Canvas(ruta_guardado, pagesize=letter)
                x_actual = margen_x
                y_actual = alto_hoja - margen_y - alto_etiqueta
                
                lista_plana_etiquetas = []
                for cod, info in self.etiquetas_solicitadas.items():
                    for _ in range(info["piezas"]):
                        lista_plana_etiquetas.append((cod, info["articulo"], info["precio"]))

                for idx, (codigo, nombre, precio) in enumerate(lista_plana_etiquetas):
                    pdf.setStrokeColorRGB(0.7, 0.7, 0.7)
                    pdf.setLineWidth(0.5)
                    pdf.rect(x_actual, y_actual, ancho_etiqueta, alto_etiqueta, stroke=1, fill=0)
                    
                    pdf.setFillColorRGB(0, 0, 0)
                    pdf.setFont("Helvetica-Bold", 4.5)
                    nombre_limpio = nombre.upper()
                    if len(nombre_limpio) > 16:
                        nombre_limpio = nombre_limpio[:14] + ".."
                    pdf.drawCentredString(x_actual + (ancho_etiqueta / 2.0), y_actual + alto_etiqueta - 6, nombre_limpio)
                    
                    pdf.setFillColorRGB(0.8, 0.1, 0.1)
                    pdf.setFont("Helvetica-Bold", 4.5)
                    pdf.drawCentredString(x_actual + (ancho_etiqueta / 2.0), y_actual + alto_etiqueta - 12, f"PRECIO: ${precio:.2f}")
                    
                    try:
                        barcode = code128.Code128(codigo, barWidth=0.4, barHeight=11)
                        barcode.drawOn(pdf, x_actual + 3, y_actual + 11)
                    except Exception:
                        pdf.setStrokeColorRGB(0, 0, 0)
                        pdf.setLineWidth(1)
                        pdf.line(x_actual + 5, y_actual + 15, x_actual + ancho_etiqueta - 5, y_actual + 15)
                    
                    pdf.setFillColorRGB(0, 0, 0)
                    pdf.setFont("Courier-Bold", 4.5)
                    pdf.drawCentredString(x_actual + (ancho_etiqueta / 2.0), y_actual + 4, str(codigo))
                    
                    x_actual += ancho_etiqueta + espacio_x
                    
                    if x_actual + ancho_etiqueta > (ancho_hoja - margen_x):
                        x_actual = margen_x
                        y_actual -= (alto_etiqueta + espacio_y)
                    
                    if y_actual < margen_y and (idx + 1 < len(lista_plana_etiquetas)):
                        pdf.showPage()
                        x_actual = margen_x
                        y_actual = alto_hoja - margen_y - alto_etiqueta
                        
                pdf.save()
                messagebox.showinfo("¡PDF GENERADO!", f"El archivo de etiquetas combinadas se ha creado correctamente.\n\nUbicación: {ruta_guardado}", parent=ventana_busc_c)
                ventana_busc_c.destroy()
            except Exception as e:
                messagebox.showerror("ERROR AL CREAR PDF", f"Ocurrió un error inesperado al procesar: \n{e}", parent=ventana_busc_c)

        btn_generar_pdf = tk.Button(pan_der, text="🖨️ IMPRIMIR TODOS LOS CÓDIGOS JUNTOS (PDF)", font=("Arial", 12, "bold"), bg="#0288d1", fg="white", height=2, command=lanzar_generacion_pdf, relief="flat", cursor="hand2")
        btn_generar_pdf.pack(fill="x", padx=15, pady=15)

    def mostrar_imagen_seleccionada(self, event):
        seleccionado = self.tree.selection()
        if not seleccionado:
            return
        item = self.tree.item(seleccionado[0])
        if not item["values"]:
            return
        codigo = str(item["values"][0])
        self.desplegar_imagen_en_visor(codigo)

    def desplegar_imagen_en_visor(self, codigo):
        try:
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT imagen FROM productos WHERE codigo = ?", (codigo,))
                res = cursor.fetchone()
                if res and res[0] and os.path.exists(res[0]):
                    img = Image.open(res[0])
                    img.thumbnail((260, 260))
                    self.imagen_actual_tk = ImageTk.PhotoImage(img)
                    self.lbl_imagen_visor.config(image=self.imagen_actual_tk, text="")
                    return
        except Exception:
            pass
        self.lbl_imagen_visor.config(image="", text="Sin imagen\ndisponible")

    def actualizar_tabla(self):
        for item in self.tree.get_children():
            self.tree.delete(item)

        self.total = 0
        ultimo_codigo = None
        for codigo, item in self.carrito.items():
            subtotal = item["cantidad"] * item["precio"]
            self.total += subtotal
            self.tree.insert("", "end", values=(codigo, item["articulo"], item["cantidad"], f"${item['precio']:.2f}", f"${subtotal:.2f}"))
            ultimo_codigo = codigo

        self.lbl_total.config(text=f"TOTAL: ${self.total:.2f}")
        
        if ultimo_codigo:
            self.desplegar_imagen_en_visor(ultimo_codigo)
        else:
            self.lbl_imagen_visor.config(image="", text="Sin imagen\nseleccionada")

    def agregar_producto(self):
        codigo = self.entry_codigo.get().strip()
        if not codigo:
            return

        try:
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT articulo, costo, precio, stock FROM productos WHERE codigo = ?", (codigo,))
                prod = cursor.fetchone()
                
            if not prod:
                messagebox.showerror("ERROR", "Producto no encontrado")
                return

            articulo, costo, precio, stock = prod

            if stock <= 0:
                messagebox.showwarning("SIN STOCK", "Producto agotado en almacén")
                return

            if codigo in self.carrito:
                if self.carrito[codigo]["cantidad"] >= stock:
                    messagebox.showwarning("STOCK", "No puedes agregar más piezas de las que hay en almacén")
                    return
                self.carrito[codigo]["cantidad"] += 1
            else:
                self.carrito[codigo] = {
                    "articulo": articulo,
                    "cantidad": 1,
                    "costo": costo,
                    "precio": precio
                }

            self.actualizar_tabla()
            self.entry_codigo.delete(0, tk.END)
        except Exception as e:
            messagebox.showerror("ERROR", f"Error al buscar artículo: {e}")

    def borrar_carrito(self):
        if self.carrito and messagebox.askyesno("Confirmar", "¿Deseas vaciar el carrito?"):
            self.carrito.clear()
            self.actualizar_tabla()
        self.entry_codigo.focus()

    def eliminar_producto_carrito(self):
        seleccionado = self.tree.selection()
        if not seleccionado:
            return
        item = self.tree.item(seleccionado[0])
        if not item["values"]:
            return
        codigo = str(item["values"][0])
        if codigo in self.carrito:
            if self.carrito[codigo]["cantidad"] > 1:
                self.carrito[codigo]["cantidad"] -= 1
            else:
                del self.carrito[codigo]
        self.actualizar_tabla()
        self.entry_codigo.focus()

    def obtener_texto_ticket(self, fecha, pago, cambio):
        texto =  "=================================\n"
        texto += "          TIENDA DAYH\n"
        texto += "=================================\n"
        texto += f"FOLIO: {self.folio}      TURNO: #{self.id_turno}\n"
        texto += f"FECHA: {fecha}\n"
        texto += f"CAJERO: {self.usuario.upper()}\n"
        texto += "---------------------------------\n"

        for codigo, item in self.carrito.items():
            subtotal = item["cantidad"] * item["precio"]
            texto += f"{item['articulo']}\n"
            texto += f" {item['cantidad']} x ${item['precio']:.2f} = ${subtotal:.2f}\n\n"

        texto += "---------------------------------\n"
        texto += f"TOTAL A PAGAR:  ${self.total:.2f}\n"
        texto += f"EFECTIVO:       ${pago:.2f}\n"
        texto += f"CAMBIO:         ${cambio:.2f}\n"
        texto += "=================================\n"
        texto += "    ¡GRACIAS POR SU COMPRA!\n"
        texto += "=================================\n"
        return texto

    def guardar_ticket_archivo(self, fecha, contenido_ticket):
        nombre = f"TICKET_{self.folio}_{fecha.replace('/', '-').replace(' ', '_').replace(':', '-')}.txt"
        ruta = os.path.join(CARPETA_TICKETS, nombre) 
        try:
            with open(ruta, "w", encoding="utf-8") as f:
                f.write(contenido_ticket)
        except:
            pass

    def mostrar_visor_ticket(self, contenido_ticket):
        ventana_ticket = tk.Toplevel(self.root)
        ventana_ticket.title(f"📄 TICKET ELECTRÓNICO - FOLIO #{self.folio - 1}")
        ventana_ticket.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_ticket) 
        
        ventana_ticket.lift()
        ventana_ticket.focus_force()
        ventana_ticket.grab_set()
        ventana_ticket.bind("<Escape>", lambda e: ventana_ticket.destroy())

        papel = tk.Frame(ventana_ticket, bg="white", bd=1, relief="solid")
        papel.pack(expand=True, padx=25, pady=20) 

        txt_visor = tk.Text(papel, bg="white", fg="black", font=("Courier", 14), wrap="none", bd=0, height=30, width=50)
        scroll = tk.Scrollbar(papel, command=txt_visor.yview)
        txt_visor.configure(yscrollcommand=scroll.set)
        
        scroll.pack(side="right", fill="y")
        txt_visor.pack(side="left", fill="both", expand=True, padx=10, pady=10)

        txt_visor.insert("1.0", contenido_ticket)
        txt_visor.config(state="disabled")

        btn_cerrar = tk.Button(
            ventana_ticket, text="❌ CERRAR VISOR (ESC)", font=("Arial", 14, "bold"), 
            bg="#2d2d2d", fg="white", relief="flat", command=ventana_ticket.destroy, cursor="hand2"
        )
        btn_cerrar.pack(fill="x", padx=100, pady=(0, 20), ipady=10)

    def nuevo_producto(self):
        ventana_nuevo = tk.Toplevel(self.root)
        ventana_nuevo.title("📦 REGISTRO DE NUEVO PRODUCTO")
        ventana_nuevo.configure(bg="#1e1e1e")
        self.poner_fullscreen(ventana_nuevo) 
        
        ventana_nuevo.lift()
        ventana_nuevo.focus_force()
        ventana_nuevo.grab_set()
        ventana_nuevo.bind("<Escape>", lambda e: ventana_nuevo.destroy())

        frame = tk.Frame(ventana_nuevo, bg="#1e1e1e")
        frame.pack(expand=True, pady=15)

        tk.Label(frame, text="📦 CREAR NUEVO PRODUCTO", font=("Arial", 22, "bold"), bg="#1e1e1e", fg="white").pack(pady=(0, 20))

        campos = {}
        datos = [
            ("CÓDIGO DE BARRAS", "codigo"),
            ("NOMBRE DEL ARTÍCULO", "nombre"),
            ("COSTO DE ADQUISICIÓN ($)", "costo"),
            ("PRECIO DE VENTA ($)", "precio"),
            ("STOCK / INVENTARIO INICIAL", "stock")
        ]

        for texto, key in datos:
            tk.Label(frame, text=texto, bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(8, 2))
            entry = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
            entry.pack(ipady=6)
            campos[key] = entry

        tk.Label(frame, text="CATEGORÍA", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(8, 2))
        categorias = ["Papeleria", "Jugueteria", "Electronica", "Ropa", "Calzado", "Accesorios", "manualidades"]
        combo_categoria = ttk.Combobox(frame, values=categorias, font=("Arial", 14), state="readonly", justify="center", width=38)
        combo_categoria.pack(ipady=4)
        combo_categoria.set("Papeleria")

        ruta_imagen_guardar = [None]
        lbl_preview = tk.Label(frame, text="Sin Imagen Cargada", font=("Arial", 11, "italic"), bg="#1e1e1e", fg="gray")

        def cargar_imagen_action():
            archivo = filedialog.askopenfilename(
                parent=ventana_nuevo,
                title="Seleccionar Imagen del Producto",
                filetypes=[("Archivos de Imagen", "*.png *.jpg *.jpeg *.bmp *.gif")]
            )
            if archivo:
                ruta_imagen_guardar[0] = archivo
                lbl_preview.config(text=f"✓ Imagen lista: {os.path.basename(archivo)}", fg="#00ff90")

        tk.Label(frame, text="IMAGEN DEL PRODUCTO (OPCIONAL)", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(15, 2))
        btn_img = tk.Button(frame, text="📂 SELECCIONAR ARCHIVO", font=("Arial", 12, "bold"), bg="#424242", fg="white", command=cargar_imagen_action, cursor="hand2")
        btn_img.pack(pady=3, ipady=6, fill="x")
        lbl_preview.pack()

        def guardar_nuevo():
            c = campos["codigo"].get().strip()
            n = campos["nombre"].get().strip()
            co_t = campos["costo"].get().strip()
            pr_t = campos["precio"].get().strip()
            st_t = campos["stock"].get().strip()
            cat = combo_categoria.get()

            if not c or not n or not co_t or not pr_t or not st_t:
                messagebox.showerror("ERROR", "Todos los campos de texto obligatorios son requeridos", parent=ventana_nuevo)
                return

            try:
                co = float(co_t)
                pr = float(pr_t)
                st = int(st_t)
                if co < 0 or pr < 0 or st < 0:
                    raise ValueError()
            except ValueError:
                messagebox.showerror("ERROR", "Valores Numéricos Inválidos o Negativos en Costo, Precio o Stock", parent=ventana_nuevo)
                return

            ruta_final_copia = ""
            if ruta_imagen_guardar[0]:
                try:
                    ext = os.path.splitext(ruta_imagen_guardar[0])[1]
                    nombre_unico = f"IMG_{c}_{int(datetime.now().timestamp())}{ext}"
                    ruta_final_copia = os.path.join(CARPETA_IMAGENES, nombre_unico)
                    shutil.copy(ruta_imagen_guardar[0], ruta_final_copia)
                except Exception as e:
                    messagebox.showwarning("ADVERTENCIA IMAGEN", f"No se pudo copiar el archivo de imagen:\n{e}", parent=ventana_nuevo)
                    ruta_final_copia = ""

            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT 1 FROM productos WHERE codigo = ?", (c,))
                    if cursor.fetchone():
                        cursor.execute("""
                            UPDATE productos 
                            SET articulo=?, costo=?, precio=?, stock=?, categoria=?, imagen=? 
                            WHERE codigo=?
                        """, (n, co, pr, st, cat, ruta_final_copia, c))
                    else:
                        cursor.execute("""
                            INSERT INTO productos (codigo, articulo, costo, precio, stock, categoria, imagen)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (c, n, co, pr, st, cat, ruta_final_copia))
                    conn.commit()

                self.actualizar_web_json()

                messagebox.showinfo("ÉXITO", f"Producto '{n}' guardado y sincronizado con el catálogo web correctamente.", parent=ventana_nuevo)
                ventana_nuevo.destroy()
            except Exception as e:
                messagebox.showerror("ERROR CRÍTICO", f"No se pudo registrar en base de datos: {e}", parent=ventana_nuevo)

        btn_guardar = tk.Button(
            frame, 
            text="💾 GUARDAR PRODUCTO", 
            font=("Arial", 14, "bold"), 
            bg="#2e7d32", 
            fg="white", 
            relief="flat",
            cursor="hand2", 
            command=guardar_nuevo
        )
        btn_guardar.pack(pady=25, ipady=10, fill="x")

    def editar_producto(self):
        ventana_edit = tk.Toplevel(self.root)
        ventana_edit.title("✏️ EDITAR PRECIO Y STOCK")
        ventana_edit.configure(bg="#1e1e1e")
        self.poner_fullscreen(ventana_edit) 
        
        ventana_edit.lift()
        ventana_edit.focus_force()
        ventana_edit.grab_set()
        ventana_edit.bind("<Escape>", lambda e: ventana_edit.destroy())

        frame = tk.Frame(ventana_edit, bg="#1e1e1e")
        frame.pack(expand=True, pady=15)

        tk.Label(frame, text="✏️ MODIFICAR PRODUCTO", font=("Arial", 22, "bold"), bg="#1e1e1e", fg="white").pack(pady=(0, 20))

        tk.Label(frame, text="CÓDIGO DEL PRODUCTO", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(8, 2))
        entry_codigo = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_codigo.pack(ipady=6)
        entry_codigo.focus()

        tk.Label(frame, text="NUEVO PRECIO DE VENTA ($)", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(20, 2))
        entry_precio = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_precio.pack(ipady=6)

        tk.Label(frame, text="NUEVO STOCK TOTAL", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(20, 2))
        entry_stock = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_stock.pack(ipady=6)

        def realizar_actualizacion():
            codigo = entry_codigo.get().strip()
            if not codigo:
                messagebox.showerror("ERROR", "Debes ingresar el código del producto", parent=ventana_edit)
                return

            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT articulo FROM productos WHERE codigo = ?", (codigo,))
                    if not cursor.fetchone():
                        messagebox.showerror("ERROR", "El producto no está registrado", parent=ventana_edit)
                        return

                precio_texto = entry_precio.get().strip()
                stock_texto = entry_stock.get().strip()

                if not precio_texto and not stock_texto:
                    messagebox.showwarning("AVISO", "Llena al menos uno de los campos para actualizar", parent=ventana_edit)
                    return

                with sqlite3.connect(DB_PATH) as conexion:
                    cursor = conexion.cursor()
                    
                    if precio_texto:
                        try:
                            nuevo_p = float(precio_texto)
                            cursor.execute("UPDATE productos SET precio = ? WHERE codigo = ?", (nuevo_p, codigo))
                        except ValueError:
                            messagebox.showerror("ERROR", "El precio debe ser un número válido", parent=ventana_edit)
                            return

                    if stock_texto:
                        try:
                            nuevo_s = int(stock_texto)
                            cursor.execute("UPDATE productos SET stock = ? WHERE codigo = ?", (nuevo_s, codigo))
                        except ValueError:
                            messagebox.showerror("ERROR", "El stock debe ser un número entero", parent=ventana_edit)
                            return

                    conexion.commit()
                
                self.actualizar_web_json()
                messagebox.showinfo("CORRECTO", "Producto actualizado exitosamente", parent=ventana_edit)
                self.actualizar_tabla()
                ventana_edit.destroy()
            except Exception as e:
                messagebox.showerror("ERROR", f"No se pudo actualizar: {e}", parent=ventana_edit)
            finally:
                self.entry_codigo.focus()

        btn_guardar = tk.Button(frame, text="💾 ACTUALIZAR DATOS", bg="#6a1b9a", fg="white", font=("Arial", 14, "bold"), width=30, height=2, relief="flat", command=realizar_actualizacion, cursor="hand2")
        btn_guardar.pack(pady=35)
        entry_stock.bind("<Return>", lambda e: realizar_actualizacion())

    def ver_inventario(self):
        ventana = tk.Toplevel(self.root)
        ventana.title("📋 CONTROL DE INVENTARIO GENERAL")
        self.poner_fullscreen(ventana) 
        ventana.configure(bg="#121212")
        
        ventana.lift()
        ventana.focus_force()
        ventana.grab_set()
        ventana.bind("<Escape>", lambda e: ventana.destroy())

        frame_top = tk.Frame(ventana, bg="#121212")
        frame_top.pack(fill="x", pady=15)

        tk.Label(frame_top, text="🔍 Filtrar Almacén:", font=("Arial", 13, "bold"), bg="#121212", fg="white").pack(side="left", padx=(40, 10))
        busqueda = tk.Entry(frame_top, font=("Arial", 15), bg="#1e1e1e", fg="white", insertbackground="white", relief="flat", width=35)
        busqueda.pack(side="left", ipady=4)
        busqueda.focus()

        lbl_info = tk.Label(ventana, text="💡 Escribe código, nombre o categoría... (¡Los productos críticos saldrán resaltados en ROJO!)", font=("Arial", 11, "italic"), bg="#121212", fg="#ff5252")
        lbl_info.pack(anchor="w", padx=40, pady=(0, 10))

        style_inv = ttk.Style()
        style_inv.configure("Inv.Treeview", background="#1e1e1e", foreground="white", fieldbackground="#1e1e1e", rowheight=35, font=("Arial", 13))
        style_inv.configure("Inv.Treeview.Heading", background="#2d2d2d", foreground="white", font=("Arial", 13, "bold"))

        tabla = ttk.Treeview(ventana, columns=("Codigo", "Articulo", "Categoria", "Precio", "Stock"), show="headings", style="Inv.Treeview")
        scroll = ttk.Scrollbar(ventana, orient="vertical", command=tabla.yview)
        tabla.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")

        columnas = ["Codigo", "Articulo", "Categoria", "Precio", "Stock"]
        for col in columnas:
            tabla.heading(col, text=col)
            tabla.column(col, anchor="center", width=250)

        tabla.tag_configure("bajo_stock", background="#b71c1c", foreground="white")

        def cargar_tabla_db(event=None):
            for item in tabla.get_children():
                tabla.delete(item)
            texto = busqueda.get().strip()
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    if texto:
                        cursor.execute("""
                            SELECT codigo, articulo, categoria, precio, stock 
                            FROM productos 
                            WHERE codigo LIKE ? OR articulo LIKE ? OR categoria LIKE ?
                        """, (f"%{texto}%", f"%{texto}%", f"%{texto}%"))
                    else:
                        cursor.execute("SELECT codigo, articulo, categoria, precio, stock FROM productos")
                        
                    for fila in cursor.fetchall():
                        tag = "bajo_stock" if fila[4] <= 1 else ""
                        tabla.insert("", "end", values=(fila[0], fila[1], fila[2], f"${fila[3]:.2f}", fila[4]), tags=(tag,))
            except Exception:
                pass

        busqueda.bind("<KeyRelease>", cargar_tabla_db)
        cargar_tabla_db()
        tabla.pack(side="left", fill="both", expand=True, padx=40, pady=(0, 20))

    def eliminar_producto(self):
        ventana_del = tk.Toplevel(self.root)
        ventana_del.title("❌ BAJA DE PRODUCTOS")
        ventana_del.configure(bg="#1e1e1e")
        self.poner_fullscreen(ventana_del) 
        
        ventana_del.lift()
        ventana_del.focus_force()
        ventana_del.grab_set()
        ventana_del.bind("<Escape>", lambda e: ventana_del.destroy())

        frame = tk.Frame(ventana_del, bg="#1e1e1e")
        frame.pack(expand=True, pady=15)

        tk.Label(frame, text="❌ ELIMINAR DEL SISTEMA", font=("Arial", 22, "bold"), bg="#1e1e1e", fg="white").pack(pady=(0, 20))
        tk.Label(frame, text="CÓDIGO DEL PRODUCTO A BORRAR", bg="#1e1e1e", fg="#ff5252", font=("Arial", 14, "bold")).pack(pady=(8, 4))
        
        entry_codigo = tk.Entry(frame, font=("Arial", 16), width=30, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_codigo.pack(ipady=6)
        entry_codigo.focus()

        def procesar_baja():
            codigo = entry_codigo.get().strip()
            if not codigo:
                messagebox.showerror("ERROR", "Debes ingresar el código", parent=ventana_del)
                return

            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT articulo, imagen FROM productos WHERE codigo = ?", (codigo,))
                    res = cursor.fetchone()
                
                if not res:
                    messagebox.showerror("ERROR", "Producto no registrado", parent=ventana_del)
                    return

                articulo, img_path = res
                if messagebox.askyesno("CONFIRMAR", f"¿Seguro que deseas eliminar permanentemente {articulo}?", parent=ventana_del):
                    if img_path and os.path.exists(img_path):
                        try:
                            os.remove(img_path)
                        except Exception:
                            pass

                    with sqlite3.connect(DB_PATH) as conexion:
                        cursor = conexion.cursor()
                        cursor.execute("DELETE FROM productos WHERE codigo = ?", (codigo,))
                        conexion.commit()

                    self.actualizar_web_json()
                    messagebox.showinfo("CORRECTO", "Producto borrado por completo.", parent=ventana_del)
                    self.actualizar_tabla()
                    ventana_del.destroy()
            except Exception as e:
                messagebox.showerror("ERROR", f"No se pudo completar la baja: {e}", parent=ventana_del)
            finally:
                self.entry_codigo.focus()

        btn_eliminar = tk.Button(frame, text="🗑 BORRAR PERMANENTEMENTE", bg="#c62828", fg="white", font=("Arial", 14, "bold"), width=30, height=2, relief="flat", command=procesar_baja, cursor="hand2")
        btn_eliminar.pack(pady=35)
        entry_codigo.bind("<Return>", lambda e: procesar_baja())

    def surtir_stock(self):
        ventana_stock = tk.Toplevel(self.root)
        ventana_stock.title("📥 SURTIR STOCK EN ALMACÉN")
        ventana_stock.configure(bg="#1e1e1e")
        self.poner_fullscreen(ventana_stock) 
        
        ventana_stock.lift()
        ventana_stock.focus_force()
        ventana_stock.grab_set()
        ventana_stock.bind("<Escape>", lambda e: ventana_stock.destroy())

        frame = tk.Frame(ventana_stock, bg="#1e1e1e")
        frame.pack(expand=True, pady=15)

        tk.Label(frame, text="📥 ENTRADA DE MERCANCÍA", font=("Arial", 22, "bold"), bg="#1e1e1e", fg="white").pack(pady=(0, 25))

        tk.Label(frame, text="CÓDIGO DEL PRODUCTO", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(8, 2))
        entry_codigo = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_codigo.pack(ipady=6)
        entry_codigo.focus()

        tk.Label(frame, text="CANTIDAD A AGREGAR (PIEZAS)", bg="#1e1e1e", fg="#00ff90", font=("Arial", 12, "bold")).pack(pady=(20, 2))
        entry_cantidad = tk.Entry(frame, font=("Arial", 16), width=35, justify="center", bg="#2d2d2d", fg="white", insertbackground="white", relief="flat")
        entry_cantidad.pack(ipady=6)

        def registrar_entrada():
            codigo = entry_codigo.get().strip()
            text_cantidad = entry_cantidad.get().strip()

            if not codigo or not text_cantidad:
                messagebox.showerror("ERROR", "Todos los campos son obligatorios", parent=ventana_stock)
                return

            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT articulo FROM productos WHERE codigo = ?", (codigo,))
                    if not cursor.fetchone():
                        messagebox.showerror("ERROR", "El artículo no existe en el sistema", parent=ventana_stock)
                        return

                try:
                    cantidad = int(text_cantidad)
                    if cantidad <= 0:
                        raise ValueError()
                except ValueError:
                    messagebox.showerror("ERROR", "Ingresa una cantidad entera mayor a 0", parent=ventana_stock)
                    return

                with sqlite3.connect(DB_PATH) as conexion:
                    cursor = conexion.cursor()
                    cursor.execute("UPDATE productos SET stock = stock + ? WHERE codigo = ?", (cantidad, codigo))
                    conexion.commit()

                self.actualizar_web_json()
                messagebox.showinfo("CORRECTO", f"¡Stock actualizado! Se agregaron {cantidad} piezas.", parent=ventana_stock)
                self.actualizar_tabla()
                ventana_stock.destroy()
            except Exception as e:
                messagebox.showerror("ERROR", f"No se pudo guardar el stock: {e}", parent=ventana_stock)
            finally:
                self.entry_codigo.focus()

        btn_surtir = tk.Button(frame, text="📥 AÑADIR AL INVENTARIO", bg="#ff9800", fg="white", font=("Arial", 14, "bold"), width=30, height=2, relief="flat", command=registrar_entrada, cursor="hand2")
        btn_surtir.pack(pady=35)
        entry_cantidad.bind("<Return>", lambda e: registrar_entrada())

    # =========================================================
    # LÓGICA DE APARTADOS LOCALES (SISTEMA DE TIENDA)
    # =========================================================
    def actualizar_apartados_json(self):
        pass

    def apartar_pedido(self):
        if self.total <= 0:
            messagebox.showwarning("VACÍO", "No hay productos en el carrito para apartar")
            return

        cliente = simpledialog.askstring("NUEVO APARTADO", "Nombre del cliente o número de WhatsApp:")
        if not cliente:
            return

        try:
            with sqlite3.connect(DB_PATH) as conexion:
                cursor = conexion.cursor()
                fecha_actual = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                
                cursor.execute("INSERT INTO apartados (cliente, fecha, total, estado) VALUES (?, ?, ?, 'PENDIENTE')", 
                               (cliente.upper(), fecha_actual, self.total))
                id_apartado = cursor.lastrowid

                for codigo, item in self.carrito.items():
                    cursor.execute("""
                        INSERT INTO detalle_apartados (id_apartado, codigo_producto, articulo, cantidad, precio_venta, costo_unitario)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (id_apartado, codigo, item["articulo"], item["cantidad"], item["precio"], item["costo"]))
                    
                    cursor.execute("UPDATE productos SET stock = stock - ? WHERE codigo = ?", (item["cantidad"], codigo))

                conexion.commit()

            self.actualizar_web_json() 
            
            messagebox.showinfo("ÉXITO", f"El pedido de {cliente} ha sido apartado.\nEl stock ya se descontó de tu inventario.")
            self.carrito.clear()
            self.actualizar_tabla()
            
        except Exception as e:
            messagebox.showerror("ERROR", f"No se pudo guardar el apartado:\n{e}")

    def ver_apartados(self):
        ventana_ap = tk.Toplevel(self.root)
        ventana_ap.title("🗓️ GESTIÓN DE APARTADOS LOCALES PENDIENTES")
        ventana_ap.configure(bg="#1a1a1a")
        self.poner_fullscreen(ventana_ap) 
        ventana_ap.bind("<Escape>", lambda e: ventana_ap.destroy())
        
        ventana_ap.lift()
        ventana_ap.focus_force()
        ventana_ap.grab_set()

        tk.Label(ventana_ap, text="📦 PEDIDOS APARTADOS LOCALES (STOCK RETENIDO)", font=("Arial", 18, "bold"), bg="#1a1a1a", fg="#ff9800").pack(pady=20)

        frame_tabla = tk.Frame(ventana_ap, bg="#1e1e1e")
        frame_tabla.pack(fill="both", expand=True, padx=40, pady=20)

        style = ttk.Style()
        style.configure("Ap.Treeview", background="#1e1e1e", foreground="white", fieldbackground="#1e1e1e", rowheight=40, font=("Arial", 12))
        
        columnas = ("ID", "Cliente", "Fecha", "Total")
        tabla = ttk.Treeview(frame_tabla, columns=columnas, show="headings", style="Ap.Treeview")
        
        anchos = [100, 400, 300, 200]
        for col, ancho in zip(columnas, anchos):
            tabla.heading(col, text=col)
            tabla.column(col, anchor="center", width=ancho)
            
        tabla.pack(side="left", fill="both", expand=True)
        
        def cargar_apartados():
            for item in tabla.get_children():
                tabla.delete(item)
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT id, cliente, fecha, total FROM apartados WHERE estado = 'PENDIENTE'")
                    for fila in cursor.fetchall():
                        tabla.insert("", "end", values=(fila[0], fila[1], fila[2], f"${fila[3]:.2f}"))
            except Exception: pass

        cargar_apartados()
        frame_btn = tk.Frame(ventana_ap, bg="#1a1a1a")
        frame_btn.pack(fill="x", pady=30, padx=50)

        def concretar_venta():
            sel = tabla.selection()
            if not sel: return
            id_ap = tabla.item(sel[0])["values"][0]
            cliente = tabla.item(sel[0])["values"][1]
            total = float(str(tabla.item(sel[0])["values"][3]).replace("$", ""))
            
            if not messagebox.askyesno("CONFIRMAR VENTA", f"¿El cliente {cliente} ya pagó los ${total}?\nEsto registrará la venta y ganancia en el corte de caja."): return
                
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE apartados SET estado = 'VENDIDO' WHERE id = ?", (id_ap,))
                    cursor.execute("SELECT codigo_producto, articulo, cantidad, precio_venta, costo_unitario FROM detalle_apartados WHERE id_apartado = ?", (id_ap,))
                    detalles = cursor.fetchall()
                    
                    ganancia_total = sum([(d[3] - d[4]) * d[2] for d in detalles])
                    fecha_actual = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
                    
                    cursor.execute("""
                        INSERT INTO ventas (folio, id_turno, fecha, cajero, total, pago, cambio, ganancia)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (self.folio, self.id_turno, fecha_actual, self.usuario, total, total, 0, ganancia_total))
                    
                    for d in detalles:
                        cursor.execute("""
                            INSERT INTO detalle_ventas (folio_venta, id_turno, codigo_producto, articulo, cantidad, costo_unitario, precio_venta)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (self.folio, self.id_turno, d[0], d[1], d[2], d[4], d[3]))
                        
                    self.folio += 1
                    cursor.execute("UPDATE config SET folio = ? WHERE id = 1", (self.folio,))
                    conn.commit()
                    
                messagebox.showinfo("VENTA REGISTRADA", "¡Venta completada con éxito!")
                cargar_apartados()
            except Exception as e:
                messagebox.showerror("ERROR", f"No se pudo completar la venta:\n{e}")

        def cancelar_apartado():
            sel = tabla.selection()
            if not sel: return
            id_ap = tabla.item(sel[0])["values"][0]
            cliente = tabla.item(sel[0])["values"][1]
            
            if not messagebox.askyesno("CANCELAR APARTADO", f"¿Deseas cancelar el pedido de {cliente}?\nLas piezas regresarán automáticamente al stock de la página web."): return
                
            try:
                with sqlite3.connect(DB_PATH) as conn:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE apartados SET estado = 'CANCELADO' WHERE id = ?", (id_ap,))
                    cursor.execute("SELECT codigo_producto, cantidad FROM detalle_apartados WHERE id_apartado = ?", (id_ap,))
                    detalles = cursor.fetchall()
                    
                    for d in detalles:
                        cursor.execute("UPDATE productos SET stock = stock + ? WHERE codigo = ?", (d[1], d[0]))
                    conn.commit()
                    
                self.actualizar_web_json()
                messagebox.showinfo("CANCELADO", "Apartado cancelado. El stock ha regresado a tu inventario y a la web.")
                cargar_apartados()
            except Exception as e:
                messagebox.showerror("ERROR", f"No se pudo cancelar:\n{e}")

        tk.Button(frame_btn, text="✅ CONCRETAR VENTA", bg="#00c853", fg="white", font=("Arial", 14, "bold"), command=concretar_venta, height=2).pack(side="left", expand=True, fill="x", padx=10)
        tk.Button(frame_btn, text="❌ CANCELAR Y DEVOLVER STOCK", bg="#d50000", fg="white", font=("Arial", 14, "bold"), command=cancelar_apartado, height=2).pack(side="left", expand=True, fill="x", padx=10)

# =========================================================
# INTERFAZ DE LOGIN AUTOMATIZADA CON BASE DE DATOS
# =========================================================
class Login:
    def __init__(self, root):
        self.root = root
        self.root.title("🔐 LOGIN POS")
        self.root.configure(bg="#121212")

        ancho = root.winfo_screenwidth()
        alto = root.winfo_screenheight()
        root.geometry(f"{ancho}x{alto}+0+0")
        
        try:
            root.state("zoomed")
        except tk.TclError:
            root.attributes("-fullscreen", True)

        self.frame = tk.Frame(root, bg="#121212")
        self.frame.pack(expand=True)

        titulo = tk.Label(self.frame, text="🔐 TIENDA DAYH", font=("Arial", 34, "bold"), bg="#121212", fg="white")
        titulo.pack(pady=30)

        tk.Label(self.frame, text="Usuario", bg="#121212", fg="white", font=("Arial", 18)).pack()
        self.usuario = tk.Entry(self.frame, font=("Arial", 22), justify="center", width=25, bg="#1e1e1e", fg="white", insertbackground="white", relief="flat")
        self.usuario.pack(pady=10, ipady=8)
        self.usuario.focus()

        tk.Label(self.frame, text="Contraseña", bg="#121212", fg="white", font=("Arial", 18)).pack()
        self.password = tk.Entry(self.frame, show="*", font=("Arial", 22), justify="center", width=25, bg="#1e1e1e", fg="white", insertbackground="white", relief="flat")
        self.password.pack(pady=10, ipady=8)
        self.password.bind("<Return>", lambda e: self.login())

        frame_botones_login = tk.Frame(self.frame, bg="#121212")
        frame_botones_login.pack(pady=30)

        btn_ingresar = tk.Button(frame_botones_login, text="INGRESAR", font=("Arial", 16, "bold"), bg="#00c853", fg="white", width=14, height=2, relief="flat", cursor="hand2", command=self.login)
        btn_ingresar.pack(side="left", padx=10)

        btn_salir = tk.Button(frame_botones_login, text="SALIR", font=("Arial", 16, "bold"), bg="#b71c1c", fg="white", width=14, height=2, relief="flat", cursor="hand2", command=self.salir_programa_login)
        btn_salir.pack(side="left", padx=10)

    def salir_programa_login(self):
        if messagebox.askyesno("SALIR", "¿Seguro que deseas cerrar el programa por completo?"):
            self.root.destroy()

    def login(self):
        user = self.usuario.get().strip()
        pas = self.password.get().strip()

        if not user or not pas:
            messagebox.showerror("ERROR", "Por favor rellene todos los campos")
            return

        pas_hash = hashlib.sha256(pas.encode()).hexdigest()

        try:
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT rol FROM usuarios WHERE usuario = ? AND password = ?", (user, pas_hash))
                resultado = cursor.fetchone()

            if resultado:
                rol = resultado[0]
                self.frame.destroy()
                POSApp(self.root, user, rol)
            else:
                messagebox.showerror("ERROR", "Usuario o contraseña incorrectos")
        except Exception as e:
            messagebox.showerror("ERROR CRÍTICO", f"Error de conexión con la base de datos de usuarios:\n{e}")

# =========================================================
# LÓGICA DEL SERVIDOR WEB PARA RECIBIR PEDIDOS
# =========================================================
class ManejadorPedidosWeb(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return

            body = self.rfile.read(content_length)
            datos_pedido = json.loads(body.decode('utf-8'))
            print(f"[SERVIDOR] Recibido pedido de: {datos_pedido.get('cliente')}")
            
            if INSTANCIA_APP:
                INSTANCIA_APP.guardar_pedido_desde_web(datos_pedido)
            
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
        except Exception as e:
            print(f"[ERROR SERVIDOR EN POST] {e}")
            self.send_response(500)
            self.end_headers()

def iniciar_servidor_segundo_plano():
    puerto = 5000 
    server_address = ('127.0.0.1', puerto)
    try:
        httpd = HTTPServer(server_address, ManejadorPedidosWeb)
        print(f"[INFO] Servidor de pedidos Web corriendo en http://127.0.0.1:{puerto}")
        httpd.serve_forever()
    except Exception as e:
        print(f"[ERROR SERVIDOR]: {e}")

def ejecutar_sincronizacion_total_web(app_instancia):
    print("[SISTEMA CENTRAL] Iniciando actualización total automatizada...")
    try:
        app_instancia.actualizar_web_json()
        if hasattr(app_instancia, 'sincronizar_github'):
            app_instancia.sincronizar_github()
            print("[SISTEMA CENTRAL] ¡Catálogo en línea en GitHub actualizado con éxito!")
        app_instancia.refrescar_desde_web()
    except Exception as e:
        print(f"[ERROR EN SINCRONIZACIÓN AUTOMÁTICA]: {e}")

# =========================================================
# EJECUCIÓN DEL PROGRAMA
# =========================================================
if __name__ == "__main__":
    inicializar_bd()

    hilo_servidor = threading.Thread(target=iniciar_servidor_segundo_plano, daemon=True)
    hilo_servidor.start()

    root = tk.Tk()
    login_screen = Login(root)
    root.mainloop()
