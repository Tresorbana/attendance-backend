import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('stations')
export class Station {
  @PrimaryGeneratedColumn()
  id: number;

  /** Display name, e.g. "Nairobi HQ" */
  @Column({ type: 'varchar', length: 150, unique: true })
  name: string;

  /** Short code, e.g. "NBI-HQ" */
  @Column({ type: 'varchar', length: 30, unique: true, nullable: true })
  code: string | null;

  /** Physical address or description */
  @Column({ type: 'varchar', length: 300, nullable: true })
  address: string | null;

  /** Station-level admin username (for portal login) */
  @Column({ type: 'varchar', length: 100, unique: true, nullable: true, name: 'admin_username' })
  adminUsername: string | null;

  /** Station-level admin password (plain text — same pattern as super-admin) */
  @Column({ type: 'varchar', length: 200, nullable: true, name: 'admin_password' })
  adminPassword: string | null;

  /** Station-level admin display name */
  @Column({ type: 'varchar', length: 150, nullable: true, name: 'admin_full_name' })
  adminFullName: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
