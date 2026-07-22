// Service worker mínimo. Su único trabajo real es EXISTIR y estar activo:
// eso es uno de los requisitos técnicos para que Chrome/PWABuilder
// consideren esto una PWA "instalable". De paso, deja funcionar la
// app (el visor/formulario) sin conexión, aunque los datos siempre
// necesitan internet porque viven en tu Google Sheet.

const CACHE_NAME = "asistencia-jymda-v1";

const ARCHIVOS_BASICOS = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./script.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function(evento){

  self.skipWaiting();

  evento.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(ARCHIVOS_BASICOS);
    })
  );

});

self.addEventListener("activate", function(evento){

  evento.waitUntil(
    caches.keys().then(function(nombres){
      return Promise.all(
        nombres
          .filter(function(nombre){ return nombre !== CACHE_NAME; })
          .map(function(nombre){ return caches.delete(nombre); })
      );
    })
  );

  self.clients.claim();

});

self.addEventListener("fetch", function(evento){

  // Las llamadas a Apps Script (script.google.com) siempre van directo
  // a la red: nunca se cachean, porque son datos en vivo.
  if(evento.request.url.indexOf("script.google.com") !== -1){
    return;
  }

  evento.respondWith(
    fetch(evento.request).catch(function(){
      return caches.match(evento.request);
    })
  );

});
