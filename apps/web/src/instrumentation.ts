/**
 * Runs once when the server starts, before it accepts requests. A half-configured connector must stop the boot with a
 * clear message instead of failing later on the first OAuth request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertConnectorConfig } = await import('core');
  assertConnectorConfig();
}
