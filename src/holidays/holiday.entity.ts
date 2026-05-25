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

  @Column({ length: 200 })
  name: string;

  /** ISO date string YYYY-MM-DD */
  @Column({ length: 10, unique: true })
  date: string;

  /** true = confirmed public holiday, false = tentative */
  @Column({ default: false })
  confirmed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
