import { Injectable } from '@nestjs/common';

export interface PaymentAccountUpdate {
  purchase: Record<string, unknown>;
  access: Record<string, unknown>;
}

type PaymentUpdateListener = (
  userId: string,
  update: PaymentAccountUpdate,
) => void;

@Injectable()
export class PaymentEventsService {
  private readonly listeners = new Set<PaymentUpdateListener>();

  subscribe(listener: PaymentUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(userId: string, update: PaymentAccountUpdate): void {
    for (const listener of this.listeners) listener(userId, update);
  }
}
