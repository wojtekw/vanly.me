export class MailerError extends Error {
  constructor(code, outcome = 'dead') {
    super(code);
    this.name = 'MailerError';
    this.code = code;
    this.outcome = outcome;
  }
}

// Never persist the provider's message: it can contain addresses or request data.
export function deliveryFailure(error) {
  if (error instanceof MailerError) return error;
  const name = error?.name;
  const status = error?.$metadata?.httpStatusCode;
  if (name === 'TooManyRequestsException' || status === 429)
    return new MailerError('SES_THROTTLED', 'retry');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.code))
    return new MailerError('SES_CONNECTION_NOT_ESTABLISHED', 'retry');
  if (['CredentialsProviderError', 'CredentialProviderError'].includes(name))
    return new MailerError('SES_CREDENTIALS_UNAVAILABLE');
  if (status >= 400 && status < 500) return new MailerError('SES_REQUEST_REJECTED');
  // SendEmail has no idempotency token. A lost response can mean accepted mail.
  return new MailerError('SES_ACCEPTANCE_UNKNOWN', 'unknown');
}
