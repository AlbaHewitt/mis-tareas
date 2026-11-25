// Despertador de los avisos: cada 5 minutos pide a GitHub que ejecute el workflow "Avisos".
// GitHub solo ejecuta los cron cuando le viene bien (a veces cada varias horas); en cambio,
// una ejecución pedida a mano (workflow_dispatch) arranca enseguida. Cloudflare sí cumple su horario.
// Necesita el secreto GITHUB_TOKEN: un token "fine-grained" con permiso Actions: Read and write
// solo sobre el repositorio mis-tareas.
const WORKFLOW = 'https://api.github.com/repos/AlbaHewitt/mis-tareas/actions/workflows/avisos.yml/dispatches';

async function despertar(env) {
  const r = await fetch(WORKFLOW, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mis-tareas-despertador',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (r.status !== 204) throw new Error(`GitHub respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(despertar(env)); },
  // Abrir la dirección del Worker no hace nada: así nadie puede lanzar avisos desde fuera
  async fetch() { return new Response('Despertador de Mis Tareas: funciona solo, cada 5 minutos.', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); },
};
