// Register only the worker in this GitHub Pages project directory.
// Private API responses and signed media are deliberately outside its cache.
(() => {
  if (!('serviceWorker' in navigator) || !['https:', 'http:'].includes(location.protocol)) return;
  const workerUrl = new URL('sw.js', document.currentScript.src);
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(workerUrl.href).catch(error => {
      console.warn('InnovateX offline screen unavailable', error);
    });
  }, { once: true });
})();
