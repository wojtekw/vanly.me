function handler(event) {
  var request = event.request;
  request.headers['x-vanly-viewer-host'] = { value: request.headers.host.value.toLowerCase() };
  return request;
}
