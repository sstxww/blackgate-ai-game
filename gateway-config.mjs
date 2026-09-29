// Shared Blackgate gateway for the public site. The public UI prefers this transport so first-time users do not depend on provider CORS or local routing.
// Forks should replace this with a gateway they control, or leave it empty and select browser-direct mode.
export const PUBLIC_GATEWAY_URL='https://blackgate-gateway-public-production.up.railway.app';
