import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Person } from '../people/people.entity';

export type AttendanceType = 'check-in' | 'check-out';

@Entity('attendance')
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Person, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @Index()
  @Column({ name: 'person_id' })
  personId: number;

  @Column('float')
  confidence: number;

  @Index()
  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  timestamp: Date;

  /** 'check-in' or 'check-out' */
  @Column({ type: 'varchar', length: 20, default: 'check-in', name: 'type' })
  type: AttendanceType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
