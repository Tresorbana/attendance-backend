import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Person } from '../people/people.entity';

@Entity('attendance')
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Person, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @Column({ name: 'person_id' })
  personId: number;

  @Column('float')
  confidence: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
