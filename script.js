//==========================================
// WRAPPER DE LA API (reemplaza google.script.run)
// Llama al doPost() de tu Apps Script (Registro de
// Asistencia) mandando { accion, ... } y devuelve
// una Promise con el mismo "data" que antes recibían
// los withSuccessHandler().
//==========================================

function llamarAPI(accion, datosExtra){

    const cuerpo = Object.assign({ accion: accion }, datosExtra || {});

    return fetch(APPS_SCRIPT_URL, {
        method: "POST",
        // OJO: no pongas headers personalizados aquí (como
        // 'Content-Type':'application/json'). Dejarlo así evita
        // que el navegador dispare un preflight CORS que Apps
        // Script no maneja bien. El doPost igual hace JSON.parse().
        body: JSON.stringify(cuerpo)
    })
    .then(function(res){ return res.json(); })
    .then(function(resp){

        if(!resp.ok){
            throw new Error(resp.mensaje || "Error desconocido del servidor.");
        }

        return resp.data;

    });

}

//==========================================
// CONFIGURACIÓN / ESTADO GENERAL
//==========================================

let trabajadores = [];

// Estado del mapa
let mapaLeaflet = null;
let circuloUbicacion = null;
let circuloPrecision = null;
let circulosZonas = [];
let zonasCache = null;

// Estado de calibración GPS
let watchIdGPS = null;
let gpsListo = false;
const UMBRAL_PRECISION_METROS = 10;
let timeoutCalibracionGPS = null;
const TIEMPO_MAXIMO_CALIBRACION_MS = 30000;

// Candados combinados para habilitar/deshabilitar botones
let horarioBloqueado = false;
let dispositivoBloqueado = false;

//==========================================
// ID DE DISPOSITIVO
// Se genera una sola vez y se guarda en este celular.
// Sirve para vincular la cuenta del trabajador a su
// propio equipo y evitar que otra persona marque por él.
//==========================================

function obtenerDeviceId(){

    let id = localStorage.getItem("jymda_device_id");

    if(!id){

        id = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : ("dev-"+Date.now()+"-"+Math.random().toString(36).slice(2));

        localStorage.setItem("jymda_device_id", id);

    }

    return id;

}

//==========================================
// INICIAR
//==========================================

window.onload = function(){

    registrarServiceWorker();

    cargarTrabajadores();

    actualizarReloj();

    setInterval(actualizarReloj,1000);

    // Buscador de la pestaña "Registrar Asistencia"
    document
        .getElementById("nombre")
        .addEventListener("keyup",buscarTrabajador);

    document
        .getElementById("nombre")
        .addEventListener("blur",function(){
            const valor = this.value.trim();
            if(valor!==""){
                verificarDispositivoYcontinuar(valor, alSeleccionarTrabajador);
            }
        });

    // Buscador de la pestaña "Mi Programación"
    document
        .getElementById("nombreConsulta")
        .addEventListener("keyup",buscarTrabajadorConsulta);

};

function registrarServiceWorker(){

    if("serviceWorker" in navigator){
        navigator.serviceWorker.register("sw.js").catch(function(err){
            console.warn("No se pudo registrar el service worker:", err);
        });
    }

}

//==========================================
// Se ejecuta cuando ya se confirmó el
// dispositivo y se seleccionó un trabajador válido
// en la pestaña "Registrar Asistencia"
//==========================================

function alSeleccionarTrabajador(nombre){

    dispositivoBloqueado = false;

    consultarProgramacion(nombre);
    iniciarMapaUbicacion(nombre);

}

//==========================================
// FECHA Y HORA
//==========================================

function actualizarReloj(){

    const ahora = new Date();

    document.getElementById("fecha").innerHTML =
        ahora.toLocaleDateString("es-PE");

    document.getElementById("hora").innerHTML =
        ahora.toLocaleTimeString("es-PE");

}

//==========================================
// CARGAR TRABAJADORES
//==========================================

function cargarTrabajadores(){

    llamarAPI("obtenerTrabajadores")
        .then(function(lista){ trabajadores = lista; })
        .catch(function(err){ console.error("Error cargando trabajadores:", err); });

}

//==========================================
// PESTAÑAS
//==========================================

function cambiarTabAsistencia(tab){

    const esPrograma = tab === "programa";

    document.getElementById("panelPrograma").style.display = esPrograma ? "block" : "none";
    document.getElementById("panelRegistrar").style.display = esPrograma ? "none" : "block";

    document.getElementById("tabBtnPrograma").className = "tabBtnAsistencia" + (esPrograma ? " activo" : "");
    document.getElementById("tabBtnRegistrar").className = "tabBtnAsistencia" + (esPrograma ? "" : " activo");

    document.getElementById("subtitulo").innerHTML =
        esPrograma ? "MI PROGRAMACIÓN" : "CONTROL DE ASISTENCIA";

}

//==========================================
// AUTOCOMPLETADO — "REGISTRAR ASISTENCIA"
//==========================================

function buscarTrabajador(){

    const texto =
    document.getElementById("nombre")
    .value
    .toLowerCase();

    const lista =
    document.getElementById("listaNombres");

    lista.innerHTML="";

    dispositivoBloqueado = false;

    ocultarProgramacion();
    ocultarMapa();

    if(texto.length<2){

        lista.style.display="none";

        return;

    }

    const encontrados = trabajadores.filter(function(nombre){

        return nombre
            .toLowerCase()
            .includes(texto);

    });

    if(encontrados.length==0){

        lista.style.display="none";

        return;

    }

    lista.style.display="block";

    encontrados.forEach(function(nombre){

        const item =
        document.createElement("div");

        item.className="itemNombre";

        item.innerHTML=nombre;

        item.onclick=function(){

            document
            .getElementById("nombre")
            .value=nombre;

            lista.style.display="none";

            verificarDispositivoYcontinuar(nombre, alSeleccionarTrabajador);

        };

        lista.appendChild(item);

    });

}

//==========================================
// VERIFICACIÓN DE DISPOSITIVO
// Se ejecuta antes de mostrar cualquier información
// (programación o registro). Si el dispositivo no
// coincide con el vinculado, bloquea el acceso.
//==========================================

function verificarDispositivoYcontinuar(nombre, callbackSiValido){

    const deviceId = obtenerDeviceId();

    llamarAPI("verificarDispositivo", { nombre: nombre, deviceId: deviceId })

        .then(function(resp){

            if(resp.ok){
                callbackSiValido(nombre);
            } else {
                mostrarBloqueoDispositivo(resp.mensaje);
            }

        })

        .catch(function(err){
            alert("No se pudo verificar el dispositivo: " + err.message);
        });

}

function mostrarBloqueoDispositivo(mensaje){

    // Bloqueamos la pestaña de Registrar Asistencia
    const caja = document.getElementById("programacionHoy");
    caja.className = "esAusencia";
    caja.innerHTML = "🚫 " + mensaje;
    caja.style.display = "block";

    dispositivoBloqueado = true;
    actualizarEstadoBotones();

    ocultarMapa();

    // Y también la pestaña de Mi Programación, por si la usa desde ahí
    document.getElementById("resultadoProgramacion").style.display = "flex";

    const tarjetaHoy = document.getElementById("tarjetaHoy");
    tarjetaHoy.className = "tarjetaDia esAusencia";
    tarjetaHoy.innerHTML =
        "<div class='tituloDia'>Acceso bloqueado</div><div class='cuerpoDia'>🚫 " + mensaje + "</div>";

    document.getElementById("tarjetaManana").innerHTML = "";
    document.getElementById("tarjetaManana").className = "tarjetaDia";

}

document.addEventListener("click",function(e){

    if(e.target.id!="nombre"){

        document
        .getElementById("listaNombres")
        .style.display="none";

    }

    if(e.target.id!="nombreConsulta"){

        document
        .getElementById("listaNombresConsulta")
        .style.display="none";

    }

});

//==========================================
// PROGRAMACIÓN DEL DÍA (banner dentro de "Registrar Asistencia")
//==========================================

function consultarProgramacion(nombre){

    const caja = document.getElementById("programacionHoy");

    caja.className="";
    caja.style.display="block";
    caja.innerHTML="Consultando tu actividad de hoy...";

    llamarAPI("obtenerProgramacionHoy", { nombre: nombre })

        .then(function(datos){
            mostrarProgramacion(datos);
        })

        .catch(function(){
            ocultarProgramacion();
        });

}

function mostrarProgramacion(datos){

    const caja = document.getElementById("programacionHoy");

    if(!datos){

        caja.className="sinAsignar";
        caja.innerHTML="No tienes una actividad programada para hoy.";
        caja.style.display="block";

        horarioBloqueado = false;
        actualizarEstadoBotones();

        return;

    }

    if(datos.tipo === "Incidencia"){

        caja.className="esAusencia";
        caja.innerHTML=
            "📌 Hoy tienes: <strong>"+datos.detalle+"</strong>"+
            "<br><small>No corresponde registrar asistencia.</small>";
        caja.style.display="block";

        horarioBloqueado = true;
        actualizarEstadoBotones();

        return;

    }

    // tipo === "Trabajo"
    let texto = "🛠️ <strong>Actividad de hoy:</strong> "+datos.detalle;

    if(datos.horaIngreso){

        texto += " ("+datos.horaIngreso;
        texto += datos.horaFin ? " a "+datos.horaFin+")" : ")";

    }

    if(datos.supervisor){
        texto += "<br>Supervisor: "+datos.supervisor;
    }

    caja.className="conDatos";
    caja.innerHTML=texto;
    caja.style.display="block";

    horarioBloqueado = false;
    actualizarEstadoBotones();

}

function ocultarProgramacion(){

    const caja = document.getElementById("programacionHoy");
    caja.style.display="none";
    caja.innerHTML="";
    caja.className="";

    horarioBloqueado = false;
    actualizarEstadoBotones();

}

//==========================================
// CONTROL COMBINADO DE LOS BOTONES
// Los botones solo se habilitan si:
// - el dispositivo no está bloqueado
// - el horario de hoy no es una Incidencia
// - el GPS ya se calibró (precisión <= umbral)
//==========================================

function actualizarEstadoBotones(){

    const bloqueado = dispositivoBloqueado || horarioBloqueado || !gpsListo;

    document.querySelector(".btnIngreso").disabled = bloqueado;
    document.querySelector(".btnSalida").disabled = bloqueado;

}

//==========================================
// MAPA DE ZONA (verde) + UBICACIÓN CALIBRÁNDOSE (azul)
//==========================================

function iniciarMapaUbicacion(nombre){

    const caja = document.getElementById("mapaZona");
    const badge = document.getElementById("precisionGPS");

    caja.style.display = "block";
    caja.innerHTML = "<div class='loader'></div>";

    gpsListo = false;
    actualizarEstadoBotones();

    badge.style.display = "block";
    badge.className = "precisionGPS calibrando";
    badge.innerHTML = "📡 Calibrando ubicación...";

    if(!navigator.geolocation){
        caja.innerHTML = "<p class='mensajeMapa' style='color:#D93025;'>El dispositivo no tiene GPS.</p>";
        badge.className = "precisionGPS error";
        badge.innerHTML = "⚠️ Este dispositivo no tiene GPS.";
        return;
    }

    detenerCalibracionGPS(); // por si ya había una calibración corriendo

    watchIdGPS = navigator.geolocation.watchPosition(

        function(posicion){
            pintarMapaZonas(posicion);
        },

        function(){
            caja.innerHTML = "<p class='mensajeMapa' style='color:#D93025;'>No fue posible obtener la ubicación.</p>";
            badge.className = "precisionGPS error";
            badge.innerHTML = "⚠️ No se pudo obtener tu ubicación.";
        },

        {
            enableHighAccuracy:true,
            timeout:20000,
            maximumAge:0
        }

    );
    timeoutCalibracionGPS = setTimeout(forzarHabilitacionPorTimeout, TIEMPO_MAXIMO_CALIBRACION_MS);
}

function detenerCalibracionGPS(){

    if(watchIdGPS !== null){
        navigator.geolocation.clearWatch(watchIdGPS);
        watchIdGPS = null;
    }

}

function detenerTimeoutCalibracion(){

    if(timeoutCalibracionGPS !== null){
        clearTimeout(timeoutCalibracionGPS);
        timeoutCalibracionGPS = null;
    }

}

function forzarHabilitacionPorTimeout(){

    if(gpsListo) return; // ya se calibró bien, no hace falta forzar nada

    detenerCalibracionGPS();

    const badge = document.getElementById("precisionGPS");
    badge.className = "precisionGPS calibrando";
    badge.innerHTML = "⚠️ No se logró una precisión ideal tras 30 segundos. Puedes registrar, pero verifica tu ubicación en el mapa.";

    gpsListo = true;
    actualizarEstadoBotones();

}

function pintarMapaZonas(posicion){

    const lat = posicion.coords.latitude;
    const lng = posicion.coords.longitude;
    const precision = posicion.coords.accuracy;

    const caja = document.getElementById("mapaZona");
    const badge = document.getElementById("precisionGPS");

    if(!mapaLeaflet){

        caja.innerHTML = ""; // limpia el loader antes de que Leaflet tome el div

        mapaLeaflet = L.map("mapaZona").setView([lat, lng], 17);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom:19,
            attribution:"© OpenStreetMap"
        }).addTo(mapaLeaflet);

        // Las zonas se piden una sola vez y se cachean (no en cada actualización de GPS)
        if(zonasCache){
            pintarZonasEnMapa(zonasCache);
        } else {
            llamarAPI("obtenerZonas")
                .then(function(zonas){
                    zonasCache = zonas;
                    pintarZonasEnMapa(zonas);
                })
                .catch(function(){});
        }

    } else {

        mapaLeaflet.setView([lat, lng], mapaLeaflet.getZoom());

    }

    if(circuloUbicacion){
        mapaLeaflet.removeLayer(circuloUbicacion);
    }
    if(circuloPrecision){
        mapaLeaflet.removeLayer(circuloPrecision);
    }

    const precisionOk = precision <= UMBRAL_PRECISION_METROS;
    const colorPunto = precisionOk ? "#1E88E5" : "#FBC02D";
    const colorBorde = precisionOk ? "#1565C0" : "#F9A825";

    // Círculo azul (o amarillo mientras calibra): ubicación real del trabajador
    circuloUbicacion = L.circleMarker([lat, lng], {
        radius:8,
        color:colorBorde,
        fillColor:colorPunto,
        fillOpacity:1,
        weight:2
    }).addTo(mapaLeaflet).bindPopup("Tu ubicación");

    circuloPrecision = L.circle([lat, lng], {
        radius: precision,
        color:colorBorde,
        fillColor:colorPunto,
        fillOpacity:0.15,
        weight:1
    }).addTo(mapaLeaflet);

    const metros = Math.round(precision);

    if(precisionOk){

        badge.className = "precisionGPS lista";
        badge.innerHTML = "✅ Precisión buena: " + metros + " m";

        gpsListo = true;
        actualizarEstadoBotones();

        detenerCalibracionGPS(); // ya no hace falta seguir escuchando
        detenerTimeoutCalibracion();

    } else {

        badge.className = "precisionGPS calibrando";
        badge.innerHTML = "📡 Calibrando... Precisión actual: " + metros + " m (se necesita ≤ " + UMBRAL_PRECISION_METROS + " m)";

        gpsListo = false;
        actualizarEstadoBotones();

    }

}

function pintarZonasEnMapa(zonas){

    circulosZonas.forEach(function(c){
        mapaLeaflet.removeLayer(c);
    });
    circulosZonas = [];

    zonas.forEach(function(zona){

        const circulo = L.circle([zona.lat, zona.lng], {
            radius: zona.radio,
            color:"#1D9B3C",
            fillColor:"#1D9B3C",
            fillOpacity:0.15,
            weight:2
        }).addTo(mapaLeaflet).bindPopup(zona.nombre);

        circulosZonas.push(circulo);

    });

}

function ocultarMapa(){

    detenerCalibracionGPS();
    detenerTimeoutCalibracion();

    const caja = document.getElementById("mapaZona");
    caja.style.display = "none";
    caja.innerHTML = "";

    const badge = document.getElementById("precisionGPS");
    badge.style.display = "none";
    badge.innerHTML = "";

    if(mapaLeaflet){
        mapaLeaflet.remove();
        mapaLeaflet = null;
        circuloUbicacion = null;
        circuloPrecision = null;
        circulosZonas = [];
    }

    zonasCache = null;

    gpsListo = false;
    actualizarEstadoBotones();

}

//==========================================
// AUTOCOMPLETADO — "MI PROGRAMACIÓN"
//==========================================

function buscarTrabajadorConsulta(){

    const texto =
    document.getElementById("nombreConsulta")
    .value
    .toLowerCase();

    const lista =
    document.getElementById("listaNombresConsulta");

    lista.innerHTML="";

    document.getElementById("resultadoProgramacion").style.display="none";

    if(texto.length<2){

        lista.style.display="none";

        return;

    }

    const encontrados = trabajadores.filter(function(nombre){

        return nombre
            .toLowerCase()
            .includes(texto);

    });

    if(encontrados.length==0){

        lista.style.display="none";

        return;

    }

    lista.style.display="block";

    encontrados.forEach(function(nombre){

        const item =
        document.createElement("div");

        item.className="itemNombre";

        item.innerHTML=nombre;

        item.onclick=function(){

            document
            .getElementById("nombreConsulta")
            .value=nombre;

            lista.style.display="none";

            verificarDispositivoYcontinuar(nombre, consultarMiProgramacion);

        };

        lista.appendChild(item);

    });

}

//==========================================
// CONSULTAR "HOY" Y "MAÑANA" EN UNA SOLA LLAMADA
//==========================================

function consultarMiProgramacion(nombre){

    const contenedor = document.getElementById("resultadoProgramacion");

    contenedor.style.display="flex";

    document.getElementById("tarjetaHoy").innerHTML = "Consultando...";
    document.getElementById("tarjetaHoy").className = "tarjetaDia";

    document.getElementById("tarjetaManana").innerHTML = "Consultando...";
    document.getElementById("tarjetaManana").className = "tarjetaDia";

    llamarAPI("obtenerMiProgramacion", { nombre: nombre })

        .then(function(resp){
            pintarTarjetaDia("tarjetaHoy", "Hoy", resp.hoy);
            pintarTarjetaDia("tarjetaManana", "Mañana", resp.manana);
        })

        .catch(function(err){

            document.getElementById("tarjetaHoy").innerHTML =
                "<span class='error'>No se pudo consultar tu programación.</span>";

            document.getElementById("tarjetaManana").innerHTML = "";

        });

}

function pintarTarjetaDia(idTarjeta, tituloDia, datos){

    const tarjeta = document.getElementById(idTarjeta);

    let clase = "sinAsignar";
    let cuerpo = "No tienes una actividad programada para " + tituloDia.toLowerCase() + ".";

    if(datos){

        if(datos.tipo === "Incidencia"){

            clase = "esAusencia";
            cuerpo = "📌 " + tituloDia + " tienes: <strong>" + datos.detalle + "</strong>";

        } else {

            clase = "conDatos";
            cuerpo = "🛠️ <strong>" + datos.detalle + "</strong>";

            if(datos.horaIngreso){
                cuerpo += "<br>Horario: " + datos.horaIngreso +
                    (datos.horaFin ? " a " + datos.horaFin : "");
            }

            if(datos.supervisor){
                cuerpo += "<br>Supervisor: " + datos.supervisor;
            }

        }

    }

    tarjeta.className = "tarjetaDia " + clase;
    tarjeta.innerHTML =
        "<div class='tituloDia'>" + tituloDia + "</div>" +
        "<div class='cuerpoDia'>" + cuerpo + "</div>";

}

//==========================================
// REGISTRAR
//==========================================

function registrar(tipo){

    const nombre =
    document.getElementById("nombre")
    .value.trim();

    if(nombre==""){

        alert("Seleccione un trabajador.");

        return;

    }

    // Evitar doble clic mientras se procesa el registro
    document.querySelector(".btnIngreso").disabled = true;
    document.querySelector(".btnSalida").disabled = true;

    document.getElementById("mensaje").innerHTML =
    '<div class="loader"></div><br>Obteniendo ubicación...';

    if(!navigator.geolocation){

        document.getElementById("mensaje").innerHTML =
        "<span class='error'>El dispositivo no tiene GPS.</span>";

        return;

    }

    navigator.geolocation.getCurrentPosition(

        function(posicion){

            registrarServidor(posicion,tipo);

        },

        function(){

            document.getElementById("mensaje").innerHTML =
            "<span class='error'>No fue posible obtener la ubicación.</span>";

            actualizarEstadoBotones(); 

        },

        {

            enableHighAccuracy:true,

            timeout:15000,

            maximumAge:0

        }

    );

}

//==========================================
// REGISTRAR EN EL SERVIDOR
//==========================================

function registrarServidor(posicion,tipo){

    const lat = posicion.coords.latitude;
    const lng = posicion.coords.longitude;

    // La zona se calcula en el servidor. Aquí solo mandamos lat/lng.
    document.getElementById("gps").innerHTML = "Ubicación capturada ✅";

    const datos = {

        nombre : document.getElementById("nombre").value,
        lat : lat,
        lng : lng,
        tipo : tipo,
        deviceId : obtenerDeviceId(),
        precision : Math.round(posicion.coords.accuracy)  

    };

    llamarAPI("registrar", { datos: datos })

        .then(function(respuesta){

            if(respuesta.ok){

                mostrarTarjetaExito(true, respuesta.mensaje);

                document.getElementById("nombre").value="";
                document.getElementById("listaNombres").style.display="none";
                ocultarProgramacion();
                ocultarMapa();

            }else{

                mostrarTarjetaExito(false, respuesta.mensaje);

                actualizarEstadoBotones(); // NUEVO

            }

        })

        .catch(function(err){

            mostrarTarjetaExito(false, err.message);

            actualizarEstadoBotones(); // NUEVO

        });

}

//==========================================
// TARJETA DE CONFIRMACIÓN (éxito o error)
//==========================================

function mostrarTarjetaExito(esExito, mensaje){

    const overlay = document.getElementById("overlayExito");
    const tarjeta = document.getElementById("tarjetaExito");
    const titulo = document.getElementById("tituloTarjetaExito");
    const cuerpo = document.getElementById("cuerpoTarjetaExito");
    const svgCheck = document.querySelector("#circuloCheckExito svg");

    tarjeta.className = "tarjetaExito" + (esExito ? "" : " error");

    if(esExito){
        titulo.innerHTML = "¡Registrado correctamente!";
        svgCheck.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
    } else {
        titulo.innerHTML = "No se pudo registrar";
        svgCheck.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
    }

    cuerpo.innerHTML = mensaje;
    overlay.className = "overlayExito mostrar";
    document.getElementById("mensaje").innerHTML = "";

}

function cerrarTarjetaExito(){
    document.getElementById("overlayExito").className = "overlayExito";
}
