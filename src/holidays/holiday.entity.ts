import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('holidays')
export class Holiday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** ISO date string YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10, unique: true })
  date: string;

  /** true = confirmed public holiday, false = tentative */
  @Column({ type: 'boolean', default: false })
  confirmed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
