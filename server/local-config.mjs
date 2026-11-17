/** Local preview is keyless by default. Only the explicit local NBA command can
 * pass this one provider secret to server code; model billing stays disabled. */
export function getLocalRuntime(args, environment) {
  if (!Array.isArray(args) || !environment || typeof environment !== 'object') throw new TypeError('Expected arguments and environment');
  const enabled = args.includes('--use-local-nba-key');
  if (!enabled) return { host: '0.0.0.0', bindings: {} };
  const key = typeof environment.BALLDONTLIE_API_KEY === 'string' ? environment.BALLDONTLIE_API_KEY.trim() : '';
  if (!key) throw new Error('Add BALLDONTLIE_API_KEY to your ignored .env.local file before starting local NBA mode.');
  return { host: '127.0.0.1', bindings: { BALLDONTLIE_API_KEY: key } };
}
