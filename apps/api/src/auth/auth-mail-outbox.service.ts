import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { OutboxRepository } from '../database/outbox.repository.js';
import {
  MailOutboxEnvelopeService,
  type AuthMailMessage,
  type AuthMailPurpose,
  type SealedMailEnvelope,
} from './mail-outbox-envelope.service.js';

export interface AuthMailOutboxPayload {
  readonly purpose: AuthMailPurpose;
  readonly userId: string;
  readonly sealed: SealedMailEnvelope;
}

@Injectable()
export class AuthMailOutboxService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly envelopes: MailOutboxEnvelopeService,
  ) {}

  enqueue(
    manager: EntityManager,
    input: AuthMailMessage & { readonly userId: string },
  ): Promise<string> {
    const eventPurpose =
      input.purpose === 'verify_email' ? 'verification' : 'password.reset';
    const eventType = `identity.mail.${eventPurpose}.requested`;
    const sealed = this.envelopes.seal(
      {
        purpose: input.purpose,
        recipient: input.recipient,
        actionValue: input.actionValue,
      },
      {
        userId: input.userId,
        purpose: input.purpose,
        eventType,
        eventVersion: 1,
      },
    );
    return this.outbox.enqueue(manager, {
      eventType,
      eventVersion: 1,
      aggregateId: input.userId,
      payload: {
        purpose: input.purpose,
        userId: input.userId,
        sealed,
      } satisfies AuthMailOutboxPayload,
    });
  }
}
