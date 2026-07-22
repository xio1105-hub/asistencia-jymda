//==========================================
// NUEVO: WRAPPER DE LA API (reemplaza google.script.run)
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
// ID DE DISPOSITIVO
// Se genera una sola vez y se guarda en este celular.
// Sirve para vincular la cuenta del trabajador a su
// propio equipo y evitar que otra persona marque por él.
//==========================================

let trabajadores = [];

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
                verificarDispositivoYcontinuar(valor, consultarProgramacion);
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

    // Si borra o cambia el nombre, ocultamos la programación anterior
    ocultarProgramacion();

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

            verificarDispositivoYcontinuar(nombre, consultarProgramacion);

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

    document.querySelector(".btnIngreso").disabled = true;
    document.querySelector(".btnSalida").disabled = true;

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
    const btnIngreso = document.querySelector(".btnIngreso");
    const btnSalida = document.querySelector(".btnSalida");

    // Por defecto, habilitados
    btnIngreso.disabled = false;
    btnSalida.disabled = false;

    if(!datos){

        caja.className="sinAsignar";
        caja.innerHTML="⚠️ No tienes una actividad programada para hoy.";
        caja.style.display="block";
        return;

    }

    if(datos.tipo === "Incidencia"){

        caja.className="esAusencia";
        caja.innerHTML=
            "📌 Hoy tienes: <strong>"+datos.detalle+"</strong>"+
            "<br><small>No corresponde registrar asistencia.</small>";
        caja.style.display="block";

        btnIngreso.disabled = true;
        btnSalida.disabled = true;

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

}

function ocultarProgramacion(){

    const caja = document.getElementById("programacionHoy");
    caja.style.display="none";
    caja.innerHTML="";
    caja.className="";

    document.querySelector(".btnIngreso").disabled=false;
    document.querySelector(".btnSalida").disabled=false;

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
    let cuerpo = "⚠️ No tienes una actividad programada para " + tituloDia.toLowerCase() + ".";

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
        deviceId : obtenerDeviceId()

    };

    llamarAPI("registrar", { datos: datos })

        .then(function(respuesta){

            if(respuesta.ok){

                mostrarTarjetaExito(true, respuesta.mensaje);

                document.getElementById("nombre").value="";
                document.getElementById("listaNombres").style.display="none";
                ocultarProgramacion();

            }else{

                mostrarTarjetaExito(false, respuesta.mensaje);

            }

        })

        .catch(function(err){

            mostrarTarjetaExito(false, err.message);

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
