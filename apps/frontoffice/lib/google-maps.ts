// Google browser keys are public by design; restrict this key in Google Cloud.
// No Places data is copied to localStorage, our API, or the database.
let pending: Promise<any> | undefined;
export function loadGoogleMaps(key: string): Promise<any> {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.maps?.importLibrary) return resolve(w.google.maps);
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      clearTimeout(timer);
      delete w.vanlyMapsReady;
      pending = undefined;
      reject(
        new Error('Nie udało się wczytać mapy Google. Spróbuj ponownie lub otwórz Google Maps.'),
      );
    };
    const timer = setTimeout(fail, 20000);
    w.vanlyMapsReady = () => {
      clearTimeout(timer);
      delete w.vanlyMapsReady;
      resolve(w.google.maps);
    };
    w.gm_authFailure = () => window.dispatchEvent(new Event('vanly-maps-error'));
    script.src =
      'https://maps.googleapis.com/maps/api/js?' +
      new URLSearchParams({
        key,
        v: 'weekly',
        loading: 'async',
        language: 'pl',
        region: 'PL',
        callback: 'vanlyMapsReady',
      });
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return pending;
}
