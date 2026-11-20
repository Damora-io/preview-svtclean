/* SVT Clean site settings, one place. The local build posts leads to tools/devserver.py (/api/lead); at hosting time
   leadEndpoint becomes the server function and gtmId the client's GTM container (loaded late, live hosts only). */
window.SVT_CONFIG = {
  leadEndpoint: /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? '/api/lead' : null,   // null on the preview: no back end there yet
  ratesUrl: 'data/rates.json',
  gtmId: null,
  reviewHosts: ['svtclean.damoradigital.com'],   // preview: dotted lines that wait on Jay stay visible
  attributionDays: 90
};
