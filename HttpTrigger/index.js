// DO NOT EDIT — this file is NOT deployed.
//
// The live API on ciboost-api-v2.azurewebsites.net is built from the
// PARENT repo's HttpTrigger/index.js (see ../../.github/workflows/deploy.yml
// in the ciboost-api repo), not from this submodule.
//
// All API changes (new endpoints, schema migrations, bugfixes) MUST be
// made in the parent repo's HttpTrigger/index.js. Editing this file has
// no effect on production — it is kept here only because removing it
// could confuse the Azure Functions tooling that scans the submodule.
//
// This stub exists so that, if this directory is ever mistakenly used
// as a Function App deployment source, every request fails loudly with
// a clear message pointing at the real source of truth — instead of
// silently serving a stale API surface.

module.exports = async function (context, req) {
  context.res = {
    status: 410,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      message: 'This submodule copy of HttpTrigger is not deployed. The live API lives in the parent ciboost-api repo.',
      source: 'ciboost-api/HttpTrigger/index.js'
    })
  };
};
