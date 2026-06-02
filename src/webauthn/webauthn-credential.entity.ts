import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('webauthn_credentials')
export class WebAuthnCredential {
  /** Base64URL-encoded credential ID (from RP). */
  @PrimaryColumn({ type: 'varchar', length: 512 })
  credentialId: string;

  @Column({ type: 'int', name: 'person_id' })
  personId: number;

  /** base64-encoded Uint8Array COSE public key. */
  @Column({ type: 'text', name: 'public_key' })
  publicKey: string;

  @Column({ type: 'bigint', default: 0 })
  counter: number;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'device_type' })
  credentialDeviceType: string | null;

  @Column({ type: 'boolean', default: false, name: 'backed_up' })
  credentialBackedUp: boolean;

  /** JSON-encoded string[] of AuthenticatorTransportFuture values. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  transports: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
