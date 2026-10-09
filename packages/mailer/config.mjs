import { MailerError } from './errors.mjs';

export function validateAddress(value) {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(
      value,
    )
  );
}

const integer = (env, key, fallback, min, max) => {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new MailerError(`INVALID_${key}`);
  return value;
};

export function loadMailerConfig(env = process.env) {
  const deploymentEnvironment = env.MAIL_DEPLOYMENT_ENVIRONMENT ?? 'production';
  if (!['local', 'production'].includes(deploymentEnvironment))
    throw new MailerError('INVALID_MAIL_DEPLOYMENT_ENVIRONMENT');
  const testModeValue = env.MAIL_TEST_MODE ?? 'false';
  if (!['true', 'false'].includes(testModeValue)) throw new MailerError('INVALID_MAIL_TEST_MODE');
  const testMode = testModeValue === 'true';
  const testRecipient = env.MAIL_TEST_RECIPIENT || undefined;
  if (testRecipient && !testMode) throw new MailerError('MAIL_TEST_RECIPIENT_REQUIRES_TEST_MODE');
  if (testMode && deploymentEnvironment !== 'local')
    throw new MailerError('MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT');
  if (testMode && !validateAddress(testRecipient))
    throw new MailerError('INVALID_MAIL_TEST_RECIPIENT');
  const provider = env.MAIL_PROVIDER || 'local';
  if (!['local', 'ses'].includes(provider)) throw new MailerError('INVALID_MAIL_PROVIDER');
  const awsProfile = env.AWS_PROFILE || undefined;
  if (testMode && provider === 'ses') {
    if (!awsProfile) throw new MailerError('MAIL_TEST_SES_PROFILE_REQUIRED');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(awsProfile))
      throw new MailerError('INVALID_MAIL_TEST_SES_PROFILE');
  }
  const appUrl = env.APP_URL || env.APP_ORIGIN || 'http://localhost:3100';
  let app;
  try {
    app = new URL(appUrl);
  } catch {
    throw new MailerError('INVALID_APP_URL');
  }
  if (
    !['http:', 'https:'].includes(app.protocol) ||
    app.username ||
    app.password ||
    app.search ||
    app.hash ||
    app.pathname !== '/'
  )
    throw new MailerError('INVALID_APP_URL');
  const from = env.MAIL_FROM || (provider === 'local' ? 'powiadomienia@vanly.local' : '');
  const replyTo = env.MAIL_REPLY_TO || (provider === 'local' ? 'pomoc@vanly.local' : '');
  const noReplyFrom = env.MAIL_FROM_NO_REPLY || from;
  const portalFrom = env.MAIL_FROM_PORTAL || from;
  if (!validateAddress(from)) throw new MailerError('INVALID_MAIL_FROM');
  if (!validateAddress(replyTo)) throw new MailerError('INVALID_MAIL_REPLY_TO');
  if (!validateAddress(noReplyFrom)) throw new MailerError('INVALID_MAIL_FROM_NO_REPLY');
  if (!validateAddress(portalFrom)) throw new MailerError('INVALID_MAIL_FROM_PORTAL');
  const timeoutMs = integer(env, 'MAIL_SEND_TIMEOUT_MS', 10000, 1000, 30000);
  const leaseSeconds = integer(env, 'MAIL_LEASE_SECONDS', 120, 60, 600);
  let startAfter = null;
  if (provider === 'ses') {
    if (env.MAIL_SES_ENABLED !== 'true') throw new MailerError('SES_EXPLICIT_ENABLE_REQUIRED');
    if (!testMode && (
      app.protocol !== 'https:' ||
      app.hostname === 'localhost' ||
      app.hostname.endsWith('.local') ||
      app.hostname.endsWith('.localhost') ||
      !app.hostname.includes('.') ||
      /^[\d.]+$/.test(app.hostname) ||
      app.hostname.includes(':')
    ))
      throw new MailerError('SES_PUBLIC_HTTPS_APP_URL_REQUIRED');
    if (
      !env.MAIL_SES_START_AFTER ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(env.MAIL_SES_START_AFTER) ||
      !Number.isFinite(Date.parse(env.MAIL_SES_START_AFTER))
    )
      throw new MailerError('SES_CUTOVER_DATE_REQUIRED');
    startAfter = new Date(env.MAIL_SES_START_AFTER).toISOString();
    for (const key of [
      'MAIL_SENDER_LEGAL_NAME',
      'MAIL_SENDER_LEGAL_ADDRESS',
      'MAIL_SENDER_REGISTRATION_DETAILS',
    ])
      if (!env[key]?.trim()) throw new MailerError(`REQUIRED_${key}`);
  }
  const region = env.MAIL_AWS_REGION || 'eu-central-1';
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new MailerError('INVALID_MAIL_AWS_REGION');
  const allowedAppOrigins = [
    ...new Set(
      [app.origin, env.APP_ORIGIN, ...(env.APP_ADDITIONAL_ORIGINS || '').split(',')]
        .filter(Boolean)
        .map((origin) => {
          let parsed;
          try {
            parsed = new URL(origin.trim());
          } catch {
            throw new MailerError('INVALID_MAIL_ALLOWED_ORIGIN');
          }
          if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash ||
            parsed.pathname !== '/'
          )
            throw new MailerError('INVALID_MAIL_ALLOWED_ORIGIN');
          if (
            provider === 'ses' && !testMode &&
            (parsed.protocol !== 'https:' ||
              parsed.hostname === 'localhost' ||
              parsed.hostname.endsWith('.local') ||
              parsed.hostname.endsWith('.localhost') ||
              !parsed.hostname.includes('.') ||
              /^[\d.]+$/.test(parsed.hostname) ||
              parsed.hostname.includes(':'))
          )
            throw new MailerError('SES_PUBLIC_HTTPS_ALLOWED_ORIGINS_REQUIRED');
          return parsed.origin;
        }),
    ),
  ];
  if (allowedAppOrigins.length > 20) throw new MailerError('MAIL_TOO_MANY_ALLOWED_ORIGINS');
  const configurationSet = env.MAIL_SES_CONFIGURATION_SET || undefined;
  if (configurationSet && !/^[A-Za-z0-9_-]{1,64}$/.test(configurationSet))
    throw new MailerError('INVALID_MAIL_SES_CONFIGURATION_SET');
  const feedbackEnabled = env.MAIL_FEEDBACK_ENABLED === 'true';
  let feedbackQueueUrl;
  let feedbackTopicArn;
  if (feedbackEnabled) {
    if (provider !== 'ses') throw new MailerError('FEEDBACK_REQUIRES_SES_PROVIDER');
    const topic = /^arn:aws:sns:([a-z0-9-]+):(\d{12}):([A-Za-z0-9_-]{1,256})$/.exec(
      env.MAIL_FEEDBACK_SNS_TOPIC_ARN || '',
    );
    let queue;
    try {
      queue = new URL(env.MAIL_FEEDBACK_QUEUE_URL);
    } catch {
      throw new MailerError('INVALID_FEEDBACK_QUEUE_URL');
    }
    const queuePath = /^\/(\d{12})\/([A-Za-z0-9_-]{1,80})$/.exec(queue.pathname);
    if (
      !topic ||
      topic[1] !== region ||
      !queuePath ||
      queuePath[1] !== topic[2] ||
      queue.protocol !== 'https:' ||
      queue.hostname !== `sqs.${region}.amazonaws.com` ||
      queue.port ||
      queue.username ||
      queue.password ||
      queue.search ||
      queue.hash
    )
      throw new MailerError('FEEDBACK_QUEUE_TOPIC_REGION_ACCOUNT_MISMATCH');
    feedbackQueueUrl = queue.href;
    feedbackTopicArn = env.MAIL_FEEDBACK_SNS_TOPIC_ARN;
    if (!configurationSet) throw new MailerError('FEEDBACK_CONFIGURATION_SET_REQUIRED');
  }
  return Object.freeze({
    deploymentEnvironment,
    testMode,
    testRecipient,
    provider,
    awsProfile,
    appUrl: app.origin,
    allowedAppOrigins: Object.freeze(allowedAppOrigins),
    from,
    replyTo,
    noReplyFrom,
    portalFrom,
    region,
    configurationSet,
    startAfter,
    feedbackEnabled,
    feedbackQueueUrl,
    feedbackTopicArn,
    feedbackBatchSize: integer(env, 'MAIL_FEEDBACK_BATCH_SIZE', 10, 1, 10),
    timeoutMs,
    leaseSeconds,
    maxAttempts: integer(env, 'MAIL_MAX_ATTEMPTS', 5, 1, 10),
    batchSize: integer(env, 'MAIL_BATCH_SIZE', 10, 1, 50),
    pollMs: integer(env, 'MAIL_POLL_MS', 5000, 100, 60000),
    retryBaseSeconds: integer(env, 'MAIL_RETRY_BASE_SECONDS', 30, 1, 3600),
    retentionHours: integer(env, 'MAIL_PAYLOAD_RETENTION_HOURS', 24, 1, 168),
    legalName: env.MAIL_SENDER_LEGAL_NAME || 'VANLY — środowisko lokalne',
    legalAddress: env.MAIL_SENDER_LEGAL_ADDRESS || '',
    registrationDetails: env.MAIL_SENDER_REGISTRATION_DETAILS || '',
  });
}
