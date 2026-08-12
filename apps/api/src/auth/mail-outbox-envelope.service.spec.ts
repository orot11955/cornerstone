import type { AuthSecurityOptions } from './auth-security.options.js';
import { MailOutboxEnvelopeService } from './mail-outbox-envelope.service.js';

describe('MailOutboxEnvelopeService', () => {
  it('encrypts recipient and action value with authenticated metadata', () => {
    const service = new MailOutboxEnvelopeService(options());
    const message = {
      purpose: 'verify_email' as const,
      recipient: 'person@example.test',
      actionValue: 'mail-v2.' + 'a'.repeat(43),
    };
    const context = mailContext('1760cd9c-485d-4cd4-8f66-34997121cd00');
    const sealed = service.seal(message, context);

    expect(sealed.keyVersion).toBe('mail-v2');
    expect(JSON.stringify(sealed)).not.toContain(message.recipient);
    expect(JSON.stringify(sealed)).not.toContain(message.actionValue);
    expect(service.open(sealed, context)).toEqual(message);
  });

  it('opens N-1 envelopes and rejects tampering, unknown keys, or context swaps', () => {
    const oldOptions = options();
    oldOptions.mailOutbox.current = oldOptions.mailOutbox.previous!;
    oldOptions.mailOutbox.previous = undefined;
    const oldService = new MailOutboxEnvelopeService(oldOptions);
    const context = mailContext(
      '1760cd9c-485d-4cd4-8f66-34997121cd00',
      'reset_password',
    );
    const sealed = oldService.seal(
      {
        purpose: 'reset_password',
        recipient: 'person@example.test',
        actionValue: 'action-v1.' + 'b'.repeat(43),
      },
      context,
    );
    const service = new MailOutboxEnvelopeService(options());

    expect(service.open(sealed, context).purpose).toBe('reset_password');
    const tamperedPrefix = sealed.ciphertext.startsWith('A') ? 'B' : 'A';
    expect(() =>
      service.open(
        {
          ...sealed,
          ciphertext: `${tamperedPrefix}${sealed.ciphertext.slice(1)}`,
        },
        context,
      ),
    ).toThrow('Invalid mail outbox envelope');
    expect(() =>
      service.open({ ...sealed, keyVersion: 'unknown' }, context),
    ).toThrow('Unknown mail outbox key version');
    expect(() =>
      service.open(
        sealed,
        mailContext('9949809e-bf1c-49d9-86ed-91521075ba38', 'reset_password'),
      ),
    ).toThrow('Invalid mail outbox envelope');
  });

  it('rejects oversized or non-canonical envelope encodings', () => {
    const service = new MailOutboxEnvelopeService(options());
    const context = mailContext('1760cd9c-485d-4cd4-8f66-34997121cd00');
    const valid = service.seal(
      {
        purpose: 'verify_email',
        recipient: 'person@example.test',
        actionValue: 'mail-v2.' + 'a'.repeat(43),
      },
      context,
    );

    expect(() =>
      service.open({ ...valid, iv: `${valid.iv}=` }, context),
    ).toThrow('Invalid mail outbox envelope');
    expect(() =>
      service.open(
        {
          ...valid,
          ciphertext: Buffer.alloc(4097).toString('base64url'),
        },
        context,
      ),
    ).toThrow('Invalid mail outbox envelope');
  });
});

function mailContext(
  userId: string,
  purpose: 'reset_password' | 'verify_email' = 'verify_email',
) {
  return {
    userId,
    purpose,
    eventType:
      purpose === 'verify_email'
        ? 'identity.mail.verification.requested'
        : 'identity.mail.password.reset.requested',
    eventVersion: 1 as const,
  };
}

function options(): AuthSecurityOptions {
  return {
    mailOutbox: {
      current: key('mail-v2', 2),
      previous: key('mail-v1', 1),
    },
  } as AuthSecurityOptions;
}

function key(id: string, fill: number): SealedKey {
  return { id, secret: Buffer.alloc(32, fill).toString('base64url') };
}

interface SealedKey {
  readonly id: string;
  readonly secret: string;
}
