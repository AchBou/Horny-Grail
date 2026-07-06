function handler(event) {
  var request = event.request;
  var uri = request.uri || '/';
  var cookies = request.cookies || {};

  function hasSignedAccessCookies() {
    return !!cookies['CloudFront-Policy']
      && !!cookies['CloudFront-Signature']
      && !!cookies['CloudFront-Key-Pair-Id'];
  }

  if (uri === '/access' || uri === '/access/') {
    request.uri = '/access.html';
    return request;
  }

  if (!hasSignedAccessCookies()) {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: {
          value: '/access?next=' + encodeURIComponent(uri)
        },
        'cache-control': {
          value: 'no-store'
        }
      }
    };
  }

  if (uri === '/' || uri === '') {
    return request;
  }

  if (uri.indexOf('.') === -1) {
    request.uri = '/200.html';
  }

  return request;
}
