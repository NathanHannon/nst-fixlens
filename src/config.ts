export function validateEnv(env: Record<string, unknown>) {
  const required = [
    'SPACES_ENDPOINT',
    'SPACES_KEY',
    'SPACES_SECRET',
    'SPACES_BUCKET',
  ];
  const missing = required.filter(
    (key) => typeof env[key] !== 'string' || !(env[key] as string).trim(),
  );
  // Database: either a single DATABASE_URL or the discrete managed-DB parts.
  const databaseUrl =
    typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (!databaseUrl) {
    for (const key of [
      'DATABASE_HOST',
      'DATABASE_USERNAME',
      'DATABASE_PASSWORD',
      'DATABASE_NAME',
    ]) {
      if (typeof env[key] !== 'string' || !(env[key] as string).trim())
        missing.push(key);
    }
  }
  if (missing.length)
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')} ` +
      '(provide DATABASE_URL or all of DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD, DATABASE_NAME)',
    );
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  if (env.DATABASE_PORT !== undefined && `${env.DATABASE_PORT}`.trim() !== '') {
    const dbPort = Number(env.DATABASE_PORT);
    if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535)
      throw new Error('DATABASE_PORT must be an integer between 1 and 65535');
  }
  const urlsToCheck = databaseUrl ? ['DATABASE_URL'] : [];
  urlsToCheck.push('SPACES_ENDPOINT');
  for (const key of urlsToCheck) {
    let url: URL;
    try {
      url = new URL(env[key] as string);
    } catch {
      throw new Error(`${key} must be a valid URL`);
    }
    if (
      key === 'DATABASE_URL' &&
      !['postgres:', 'postgresql:'].includes(url.protocol)
    )
      throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    if (
      key === 'SPACES_ENDPOINT' &&
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new Error('SPACES_ENDPOINT must use https:// or http://');
  }
  return { ...env, PORT: port };
}
